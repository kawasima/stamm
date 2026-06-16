#!/usr/bin/env node
import { createSqlBehaviors, makeSqlite, migrateToLatest, makeCtx } from "../impl/index.js";
import { ensureBootstrapped } from "../impl/bootstrap.js";
import { createHttpServer } from "../http/server.js";

/**
 * Remote HTTP entry point. Serves the MCP server over Streamable HTTP with
 * per-user JWT (EdDSA) authentication, so multiple team members can each point
 * their own client at one shared stamm.
 *
 * Env:
 *   STAMM_DB        sqlite file (default ./stamm.db)
 *   STAMM_HTTP_PORT listen port (default 3000)
 *   STAMM_HTTP_HOST listen host (default 127.0.0.1)
 *   STAMM_HTTP_PATH MCP endpoint path (default /mcp)
 *   STAMM_JWT_ISS   optional expected JWT issuer
 *   STAMM_JWT_AUD   optional expected JWT audience
 *
 * NOTE: logging goes to stderr; the one-time seed private keys are printed there.
 */
async function main(): Promise<void> {
  const dbPath = process.env.STAMM_DB ?? "stamm.db";
  const db = makeSqlite(dbPath);
  await migrateToLatest(db);
  const ctx = makeCtx(db);
  const behaviors = createSqlBehaviors(db);

  const seed = await ensureBootstrapped(behaviors);
  if (seed) {
    console.error(`[stamm] bootstrapped a fresh database (admin=${seed.adminId}, member=${seed.memberId}, project=${seed.projectId})`);
    console.error("[stamm] SAVE THESE private keys — shown only once:");
    console.error(`[stamm]   admin  (${seed.adminId}) kid=${seed.adminKey.keyId} privateJwk=${JSON.stringify(seed.adminKey.privateKey)}`);
    console.error(`[stamm]   member (${seed.memberId}) kid=${seed.memberKey.keyId} privateJwk=${JSON.stringify(seed.memberKey.privateKey)}`);
  }

  const path = process.env.STAMM_HTTP_PATH ?? "/mcp";
  const server = createHttpServer({
    behaviors,
    ctx,
    path,
    authConfig: { issuer: process.env.STAMM_JWT_ISS, audience: process.env.STAMM_JWT_AUD },
  });

  const port = Number(process.env.STAMM_HTTP_PORT ?? 3000);
  const host = process.env.STAMM_HTTP_HOST ?? "127.0.0.1";
  server.listen(port, host, () => {
    console.error(`[stamm] db=${dbPath} — serving MCP over http://${host}:${port}${path}`);
  });
}

main().catch((err) => {
  console.error("[stamm] fatal:", err);
  process.exit(1);
});
