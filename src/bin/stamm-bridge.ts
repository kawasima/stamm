#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createBridge, type BridgeKey } from "../http/bridge.js";

/**
 * Local signing bridge for MCP clients that cannot mint short-lived JWTs (for
 * example one that only accepts a static Authorization header). It listens on
 * loopback, signs a fresh token per request and forwards to a remote stamm.
 *
 * Env:
 *   STAMM_URL       remote endpoint, e.g. http://host:3000/mcp   (required)
 *   STAMM_KEY_FILE  JSON from user_key_issue: {userId, keyId, privateKey}  (required)
 *   STAMM_BRIDGE_PORT  listen port (default 8787)
 *   STAMM_BRIDGE_HOST  listen address (default 127.0.0.1)
 *   STAMM_BRIDGE_ALLOW comma-separated source IPs allowed to call the bridge.
 *                   Required when STAMM_BRIDGE_HOST is not loopback.
 *   STAMM_JWT_ISS / STAMM_JWT_AUD  optional, must match the server's setting
 *
 * The bridge does not authenticate callers; it holds the key for them. Anyone
 * who can reach it acts with the key's rights. That is why it listens on
 * loopback unless told otherwise, and why a non-loopback host needs an explicit
 * source allowlist (use a private network such as Tailscale, whose source
 * addresses are authenticated).
 */
function main(): void {
  const url = process.env.STAMM_URL;
  const keyFile = process.env.STAMM_KEY_FILE;
  if (!url || !keyFile) {
    console.error("[stamm-bridge] set STAMM_URL and STAMM_KEY_FILE");
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(keyFile, "utf8")) as Partial<BridgeKey>;
  if (!raw.userId || !raw.keyId || !raw.privateKey) {
    console.error("[stamm-bridge] STAMM_KEY_FILE must contain userId, keyId and privateKey");
    process.exit(1);
  }
  const host = process.env.STAMM_BRIDGE_HOST ?? "127.0.0.1";
  const allowFrom = (process.env.STAMM_BRIDGE_ALLOW ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (!loopback && allowFrom.length === 0) {
    console.error("[stamm-bridge] STAMM_BRIDGE_HOST is not loopback: set STAMM_BRIDGE_ALLOW to the source IPs allowed to connect");
    process.exit(1);
  }
  const server = createBridge({
    allowFrom: allowFrom.length > 0 ? allowFrom : undefined,
    upstream: url,
    key: { userId: raw.userId, keyId: raw.keyId, privateKey: raw.privateKey },
    issuer: process.env.STAMM_JWT_ISS,
    audience: process.env.STAMM_JWT_AUD,
  });
  const port = Number(process.env.STAMM_BRIDGE_PORT ?? 8787);
  server.listen(port, host, () => {
    console.error(`[stamm-bridge] http://${host}:${port}/mcp -> ${url} as ${raw.userId} (key ${raw.keyId})`);
  });
}

main();
