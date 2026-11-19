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
 *   STAMM_JWT_ISS / STAMM_JWT_AUD  optional, must match the server's setting
 *
 * The listener is bound to 127.0.0.1 and is not configurable: anyone who can
 * reach it acts with the key's rights.
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
  const server = createBridge({
    upstream: url,
    key: { userId: raw.userId, keyId: raw.keyId, privateKey: raw.privateKey },
    issuer: process.env.STAMM_JWT_ISS,
    audience: process.env.STAMM_JWT_AUD,
  });
  const port = Number(process.env.STAMM_BRIDGE_PORT ?? 8787);
  server.listen(port, "127.0.0.1", () => {
    console.error(`[stamm-bridge] http://127.0.0.1:${port}/mcp -> ${url} as ${raw.userId} (key ${raw.keyId})`);
  });
}

main();
