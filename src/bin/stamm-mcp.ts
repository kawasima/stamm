#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSqlBehaviors, makeSqlite, migrateToLatest } from "../impl/index.js";
import { ensureBootstrapped } from "../impl/bootstrap.js";
import { createStammServer } from "../mcp/server.js";
import { isRestricted, parseScopeEnv } from "./stdio-scope.js";

/**
 * stdio entry point for Claude Code (and any MCP host).
 *
 * Config (e.g. in .mcp.json):
 *   command: node, args: [dist/bin/stamm-mcp.js]
 *   env: STAMM_DB=stamm.db   (sqlite file; defaults to ./stamm.db)
 *        STAMM_ACTOR=<userId> (pinned identity; defaults to the bootstrap member)
 *        STAMM_SCOPE=<json>   (optional, e.g. {"readOnly":true,"projectIds":["<id>"]};
 *                              same shape as an HTTP key's scope. Unset = unrestricted.)
 *
 * NOTE: MCP speaks JSON-RPC over stdout — all logging goes to stderr.
 */
async function main(): Promise<void> {
  const dbPath = process.env.STAMM_DB ?? "stamm.db";
  const db = makeSqlite(dbPath);
  await migrateToLatest(db);
  const behaviors = createSqlBehaviors(db);

  const seed = await ensureBootstrapped(behaviors);
  if (seed) {
    console.error(`[stamm] bootstrapped a fresh database (admin=${seed.adminId}, member=${seed.memberId}, project=${seed.projectId})`);
  }

  let actorId = process.env.STAMM_ACTOR;
  if (!actorId) {
    actorId = seed?.memberId ?? (await behaviors.listUsers({ pagination: { limit: 1 } })).items[0]?.id;
  }
  if (!actorId) {
    console.error("[stamm] no actor available; set STAMM_ACTOR to a user id");
    process.exit(1);
  }
  console.error(`[stamm] db=${dbPath} actor=${actorId} — serving over stdio`);

  const scope = parseScopeEnv(process.env.STAMM_SCOPE);
  const restricted = isRestricted(scope);
  if (scope.projectIds) {
    for (const id of scope.projectIds) {
      const row = await db.selectFrom("projects").select("id").where("id", "=", id).executeTakeFirst();
      if (!row) {
        console.error(`[stamm] STAMM_SCOPE names an unknown project: ${id}`);
        process.exit(1);
      }
    }
  }
  if (restricted) console.error(`[stamm] scope=${JSON.stringify(scope)}`);

  const server = createStammServer(restricted ? createSqlBehaviors(db, { scope }) : behaviors, { actorId, scope: restricted ? scope : undefined });
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[stamm] fatal:", err);
  process.exit(1);
});
