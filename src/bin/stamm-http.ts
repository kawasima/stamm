#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { createSqlBehaviors, makeSqlite, migrateToLatest, makeCtx } from "../impl/index.js";
import { ensureBootstrapped } from "../impl/bootstrap.js";
import { reportSeedKeys } from "./seed-keys.js";
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
 *   STAMM_SEED_KEYS_FILE  opt-in: dump seeded private keys ONCE to this 0600 file
 *
 * NOTE: logging goes to stderr. On a fresh DB the seeded users' PRIVATE keys are
 * written to disk ONLY when STAMM_SEED_KEYS_FILE is set (secure default: nothing
 * is persisted, and the operator is told how to mint an admin key via stdio).
 * Private keys are never logged, since stderr can leak into system logs.
 */
async function main(): Promise<void> {
  const dbPath = process.env.STAMM_DB ?? "stamm.db";
  const db = makeSqlite(dbPath);
  await migrateToLatest(db);
  const ctx = makeCtx(db);
  const behaviors = createSqlBehaviors(db);

  const seed = await ensureBootstrapped(behaviors);
  if (seed) {
    reportSeedKeys(seed, {
      keysFile: process.env.STAMM_SEED_KEYS_FILE,
      writeFile: (path, data) => writeFileSync(path, data, { mode: 0o600 }),
      log: (msg) => console.error(`[stamm] ${msg}`),
    });
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
