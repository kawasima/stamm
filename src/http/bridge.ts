import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { importJWK, SignJWT } from "jose";

/** The parts of an issued key the bridge needs (the JSON `user_key_issue` returned). */
export interface BridgeKey {
  userId: string;
  keyId: string;
  /** Private JWK (Ed25519). */
  privateKey: Record<string, unknown>;
}

export interface BridgeOptions {
  /** Full URL of the stamm MCP endpoint, e.g. http://host:3000/mcp */
  upstream: string;
  key: BridgeKey;
  issuer?: string;
  audience?: string;
  /** Lifetime of each signed token in seconds (default 60). */
  tokenTtlSec?: number;
  /**
   * Source addresses allowed to use the bridge; anything else gets 403. Required
   * in practice whenever the bridge listens beyond loopback, because the bridge
   * itself does not authenticate callers: it holds the key on their behalf.
   */
  allowFrom?: string[];
  /** Max request body in bytes (default 1 MiB). */
  maxBodyBytes?: number;
  fetch?: typeof fetch;
}

const FORWARD_REQUEST_HEADERS = ["content-type", "accept", "mcp-protocol-version", "mcp-session-id"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "mcp-session-id", "cache-control"];

/**
 * A local MCP endpoint that signs a fresh short-lived JWT for every request and
 * forwards it to a remote stamm. It exists for MCP clients that can only send a
 * static `Authorization` header, which would expire within minutes.
 *
 * Whoever can reach this listener acts with the key's rights, so bind it to
 * loopback only (the bin does) and keep the key scoped.
 */
export function createBridge(opts: BridgeOptions): Server {
  const doFetch = opts.fetch ?? fetch;
  const ttl = opts.tokenTtlSec ?? 60;
  const maxBody = opts.maxBodyBytes ?? 1024 * 1024;
  const keyPromise = importJWK(opts.key.privateKey as never, "EdDSA");

  const sign = async (): Promise<string> => {
    let jwt = new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA", kid: opts.key.keyId })
      .setSubject(opts.key.userId)
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`);
    if (opts.issuer) jwt = jwt.setIssuer(opts.issuer);
    if (opts.audience) jwt = jwt.setAudience(opts.audience);
    return jwt.sign(await keyPromise);
  };

  const fail = (res: ServerResponse, status: number, message: string): void => {
    if (res.headersSent) return void res.end();
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  };

  const allowed = opts.allowFrom ? new Set(opts.allowFrom) : undefined;

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        if (allowed) {
          // An IPv4 peer can show up as ::ffff:a.b.c.d on a dual-stack socket.
          const peer = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
          if (!allowed.has(peer)) return fail(res, 403, "forbidden");
        }
        let body: Buffer | undefined;
        if (req.method !== "GET" && req.method !== "HEAD") {
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const c of req) {
            total += (c as Buffer).length;
            if (total > maxBody) return fail(res, 413, "request body too large");
            chunks.push(c as Buffer);
          }
          body = Buffer.concat(chunks);
        }

        const headers: Record<string, string> = { authorization: `Bearer ${await sign()}` };
        for (const name of FORWARD_REQUEST_HEADERS) {
          const v = req.headers[name];
          if (typeof v === "string") headers[name] = v;
        }

        const ac = new AbortController();
        res.on("close", () => ac.abort());
        const upstream = await doFetch(opts.upstream, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined, signal: ac.signal });

        const out: Record<string, string> = {};
        for (const name of FORWARD_RESPONSE_HEADERS) {
          const v = upstream.headers.get(name);
          if (v !== null) out[name] = v;
        }
        res.writeHead(upstream.status, out);
        if (!upstream.body) return void res.end();
        // Stream, so SSE responses reach the client as they arrive.
        for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
        res.end();
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.error("[stamm-bridge] error:", (err as Error).message);
        fail(res, 502, "upstream unreachable");
      }
    })();
  });
}
