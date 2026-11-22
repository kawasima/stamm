#!/usr/bin/env node
import { createSqlBehaviors, makeSqlite, migrateToLatest, makeCtx } from "../impl/index.js";
import { ensureBootstrapped, issueSeedKeys, revokeSeedKeys } from "../impl/bootstrap.js";
import { reportSeedKeys, writeSecretFile } from "./seed-keys.js";
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
 *   STAMM_SEED_KEYS_FILE  opt-in: on a fresh DB, mint seed keys and dump them
 *                   ONCE to this new 0600 file (an existing file is refused)
 *
 * NOTE: logging goes to stderr. Without STAMM_SEED_KEYS_FILE no seed keys are
 * minted, and the operator is told how to mint an admin key via stdio. If the
 * dump fails, the minted keys are revoked. Private keys are never logged, since
 * stderr can leak into system logs.
 */
/** A positive whole number from the environment; a typo must not silently lift a limit. */
function limitFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number, got "${raw}"`);
  return n;
}

async function main(): Promise<void> {
  const dbPath = process.env.STAMM_DB ?? "stamm.db";
  const db = makeSqlite(dbPath);
  await migrateToLatest(db);
  const ctx = makeCtx(db);
  const behaviors = createSqlBehaviors(db);

  const seed = await ensureBootstrapped(behaviors);
  if (seed) {
    await reportSeedKeys(seed, {
      keysFile: process.env.STAMM_SEED_KEYS_FILE,
      dbPath,
      issueKeys: () => issueSeedKeys(behaviors, seed),
      revokeKeys: (keys) => revokeSeedKeys(behaviors, seed, keys),
      writeFile: writeSecretFile,
      log: (msg) => console.error(`[stamm] ${msg}`),
    });
  }

  const callsPerMinute = limitFromEnv("STAMM_CALLS_PER_MINUTE");
  const failuresPerMinute = limitFromEnv("STAMM_AUTH_FAILURES_PER_MINUTE");
  const path = process.env.STAMM_HTTP_PATH ?? "/mcp";
  const server = createHttpServer({
    behaviors,
    scopedBehaviors: (scope) => createSqlBehaviors(db, { scope }),
    ctx,
    path,
    authConfig: { issuer: process.env.STAMM_JWT_ISS, audience: process.env.STAMM_JWT_AUD },
    rateLimit: process.env.STAMM_RATE_LIMIT === "off" ? false : {
      ...(callsPerMinute !== undefined ? { callsPerMinute } : {}),
      ...(failuresPerMinute !== undefined ? { failuresPerMinute } : {}),
    },
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
