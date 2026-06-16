#!/usr/bin/env node
import { writeFileSync } from "node:fs";
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
 *   STAMM_SEED_KEYS_FILE  where to write seeded private keys (default ./stamm-seed-keys.json)
 *
 * NOTE: logging goes to stderr. On a fresh DB the seeded users' PRIVATE keys are
 * written ONCE to a 0600 file (never stderr, which can leak into system logs).
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
    const keysFile = process.env.STAMM_SEED_KEYS_FILE ?? "stamm-seed-keys.json";
    const payload = {
      note: "Seeded signing keys — shown once. Keep these private keys secret; delete this file once distributed.",
      admin: { userId: seed.adminId, keyId: seed.adminKey.keyId, algorithm: seed.adminKey.algorithm, privateKey: seed.adminKey.privateKey },
      member: { userId: seed.memberId, keyId: seed.memberKey.keyId, algorithm: seed.memberKey.algorithm, privateKey: seed.memberKey.privateKey },
    };
    writeFileSync(keysFile, JSON.stringify(payload, null, 2), { mode: 0o600 });
    console.error(`[stamm] wrote seeded private keys to ${keysFile} (mode 0600) — distribute and then delete it.`);
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
