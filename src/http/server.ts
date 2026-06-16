import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createStammServer } from "../mcp/server.js";
import type { Behaviors } from "../mcp/behaviors.js";
import type { Ctx } from "../impl/ctx.js";
import { UnauthorizedError } from "../impl/errors.js";
import { authenticate, type AuthConfig } from "./auth.js";

export interface HttpServerOptions {
  behaviors: Behaviors;
  /** Used by the auth layer to look up per-user public keys. */
  ctx: Ctx;
  /** Path the MCP endpoint is served on (default "/mcp"). */
  path?: string;
  authConfig?: AuthConfig;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
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

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== path) return sendJson(res, 404, { error: "not found" });

        const actorId = await authenticate(opts.ctx, req.headers.authorization, opts.authConfig);

        const server = createStammServer(opts.behaviors, { actorId });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);

        const parsedBody = req.method === "POST" ? await readJson(req) : undefined;
        await transport.handleRequest(req, res, parsedBody);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          if (!res.headersSent) sendJson(res, 401, { error: err.message });
          return;
        }
        console.error("[stamm-http] error:", err);
        if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      }
    })();
  });
}
