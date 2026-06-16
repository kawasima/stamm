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
