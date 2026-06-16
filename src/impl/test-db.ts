import type { Kysely } from "kysely";
import type { Database } from "./db/schema.js";
import { makeSqlite } from "./db/dialects.js";
import { migrateToLatest } from "./db/migrate.js";

/** A fresh, migrated in-memory SQLite database, isolated per test. */
export async function createTestDb(): Promise<Kysely<Database>> {
  const db = makeSqlite(":memory:");
  await migrateToLatest(db);
  return db;
}

/**
 * Insert a global-admin user with a fixed id, bypassing `genId` so deterministic
 * counting-id tests aren't shifted. Config/project/workflow administration is
 * now admin-gated, so a test that exercises those writes needs a real admin row
 * to use as the actor.
 */
export async function seedAdmin(db: Kysely<Database>, id = "admin"): Promise<string> {
  await db
    .insertInto("users")
    .values({ id, login: id, email: `${id}@test.local`, display_name: id, language: "en", kind: "admin" })
    .execute();
  return id;
}
