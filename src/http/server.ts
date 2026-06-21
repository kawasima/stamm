import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createStammServer } from "../mcp/server.js";
import type { Behaviors } from "../mcp/behaviors.js";
import type { Ctx } from "../impl/ctx.js";
import { UnauthorizedError } from "../impl/errors.js";
import { authenticate, type AuthConfig } from "./auth.js";

export interface RateLimitOptions {
  /** Sliding-window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per client IP per window. */
  max: number;
}

export interface HttpServerOptions {
  behaviors: Behaviors;
  /** Used by the auth layer to look up per-user public keys. */
  ctx: Ctx;
  /** Path the MCP endpoint is served on (default "/mcp"). */
  path?: string;
  authConfig?: AuthConfig;
  /** Max request body size in bytes (default 1 MiB). Larger bodies get 413. */
  maxBodyBytes?: number;
  /**
   * Per-IP request rate limit (default 600 req/min). Pass `false` to disable
   * (e.g. when an upstream proxy already enforces limits). This is an in-process
   * fixed-window guard against floods/auth brute-force — not a substitute for an
   * edge limiter, but a safe default for a directly-exposed server.
   */
  rateLimit?: RateLimitOptions | false;
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 600 };
/** Slowloris guards: cap how long headers and a whole request may take. */
const HEADERS_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** A fixed-window per-key counter. Returns false when the key is over budget. */
function makeRateLimiter(opts: RateLimitOptions): (key: string, now: number) => boolean {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return (key, now) => {
    const w = windows.get(key);
    if (!w || now >= w.resetAt) {
      windows.set(key, { count: 1, resetAt: now + opts.windowMs });
      // Opportunistically drop expired windows so the map can't grow unbounded.
      if (windows.size > 10_000) {
        for (const [k, v] of windows) if (now >= v.resetAt) windows.delete(k);
      }
      return true;
    }
    if (w.count >= opts.max) return false;
    w.count++;
    return true;
  };
}

/** Thrown by readJson when the body exceeds the cap; mapped to HTTP 413. */
class PayloadTooLargeError extends Error {}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
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
  const rl = opts.rateLimit === false ? undefined : makeRateLimiter(opts.rateLimit ?? DEFAULT_RATE_LIMIT);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== path) return sendJson(res, 404, { error: "not found" });

        // Rate-limit per client IP before doing any auth/DB work, so a flood of
        // bad-token requests can't exhaust the backend.
        if (rl) {
          const ip = req.socket.remoteAddress ?? "unknown";
          if (!rl(ip, Date.now())) return sendJson(res, 429, { error: "rate limit exceeded" });
        }

        const actorId = await authenticate(opts.ctx, req.headers.authorization, opts.authConfig);

        const server = createStammServer(opts.behaviors, { actorId });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);

        const parsedBody = req.method === "POST" ? await readJson(req, maxBodyBytes) : undefined;
        await transport.handleRequest(req, res, parsedBody);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          if (!res.headersSent) sendJson(res, 401, { error: err.message });
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
