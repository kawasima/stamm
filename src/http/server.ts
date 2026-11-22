import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createStammServer } from "../mcp/server.js";
import { buildInstructions } from "../mcp/instructions.js";
import type { Behaviors } from "../mcp/behaviors.js";
import type { Ctx } from "../impl/ctx.js";
import { UnauthorizedError } from "../impl/errors.js";
import type { KeyScope } from "../schema/index.js";
import { authenticate, claimedKeyId, type AuthConfig } from "./auth.js";
import { CallLimiter, FailureLimiter, RateLimitedError } from "./rate-limit.js";

export interface RateLimitOptions {
  /** Calls per minute for each key (default 600). A key may spend a third of it at once. */
  callsPerMinute?: number;
  /** Failed authentications per minute for each client address (default 60). */
  failuresPerMinute?: number;
}

export interface HttpServerOptions {
  behaviors: Behaviors;
  /**
   * Build a behavior set whose permission layer enforces `scope`. Required to
   * serve scoped keys: without it a key carrying a scope is refused rather than
   * served with the unrestricted `behaviors`.
   */
  scopedBehaviors?: (scope: KeyScope) => Behaviors;
  /** Used by the auth layer to look up per-user public keys. */
  ctx: Ctx;
  /** Path the MCP endpoint is served on (default "/mcp"). */
  path?: string;
  authConfig?: AuthConfig;
  /** Max request body size in bytes (default 1 MiB). Larger bodies get 413. */
  maxBodyBytes?: number;
  /**
   * Limits on calls per key and on failed authentications per address (see
   * rate-limit.ts). Pass `false` to disable both, e.g. when a proxy in front
   * enforces them.
   */
  rateLimit?: RateLimitOptions | false;
  /** The current time in milliseconds, for the limits. */
  now?: () => number;
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_CALLS_PER_MINUTE = 600;
const DEFAULT_FAILURES_PER_MINUTE = 60;
/** Slowloris guards: cap how long headers and a whole request may take. */
const HEADERS_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** Thrown by readJson when the body exceeds the cap; mapped to HTTP 413. */
class PayloadTooLargeError extends Error {}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(text);
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) throw new PayloadTooLargeError(`request body exceeds ${maxBytes} bytes`);
    chunks.push(buf);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Remote HTTP transport for the MCP server. Stateless: every request is
 * authenticated fresh, then a per-actor McpServer + transport are built, used
 * for that single request, and torn down. Because actorId is pinned at server
 * construction, the authenticated identity can never outlive one request — a
 * session can't be reused by a different user.
 *
 * CORS is NOT set (MCP clients are not browsers). To call this from a browser,
 * add Access-Control-Allow-Origin/-Headers (Authorization, Content-Type,
 * Mcp-Session-Id) and answer OPTIONS preflight here.
 */
export function createHttpServer(opts: HttpServerOptions): Server {
  const path = opts.path ?? "/mcp";
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const now = opts.now ?? Date.now;
  const limits = opts.rateLimit === false ? undefined : {
    calls: new CallLimiter(opts.rateLimit?.callsPerMinute ?? DEFAULT_CALLS_PER_MINUTE),
    failures: new FailureLimiter(opts.rateLimit?.failuresPerMinute ?? DEFAULT_FAILURES_PER_MINUTE),
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== path) return sendJson(res, 404, { error: "not found" });

        const authorization = req.headers.authorization;
        const verify = () => authenticate(opts.ctx, authorization, opts.authConfig);
        const { actorId, keyId, scope } = limits
          ? await limits.failures.guard(req.socket.remoteAddress ?? "unknown", claimedKeyId(authorization), now, verify)
          : await verify();
        // The request itself is one call; a batch is charged for the rest once read.
        limits?.calls.spend(keyId, 1, now());

        const restricted = scope.readOnly === true || scope.projectIds !== undefined;
        if (restricted && !opts.scopedBehaviors) {
          console.error("[stamm-http] a scoped key was presented but no scopedBehaviors is configured; refusing");
          return sendJson(res, 500, { error: "internal error" });
        }

        const parsedBody = req.method === "POST" ? await readJson(req, maxBodyBytes) : undefined;
        if (limits && Array.isArray(parsedBody) && parsedBody.length > 1) {
          if (parsedBody.length > limits.calls.maxBatch) throw new PayloadTooLargeError(`a batch may hold at most ${limits.calls.maxBatch} calls`);
          limits.calls.spend(keyId, parsedBody.length - 1, now());
        }

        const served = restricted ? opts.scopedBehaviors!(scope) : opts.behaviors;
        const instructions = await buildInstructions(served, actorId);
        const server = createStammServer(served, { actorId, scope: restricted ? scope : undefined, ...(instructions ? { instructions } : {}) });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);

        await transport.handleRequest(req, res, parsedBody);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          if (!res.headersSent) sendJson(res, 401, { error: err.message });
          return;
        }
        if (err instanceof RateLimitedError) {
          if (!res.headersSent) sendJson(res, 429, { error: err.message }, { "Retry-After": String(err.retryAfterSec) });
          return;
        }
        if (err instanceof PayloadTooLargeError) {
          if (!res.headersSent) sendJson(res, 413, { error: err.message });
          return;
        }
        console.error("[stamm-http] error:", err);
        if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      }
    })();
  });

  // Slowloris guards: a client can't hold a connection open indefinitely.
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return server;
}
