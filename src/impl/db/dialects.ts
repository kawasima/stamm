import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import type { Database } from "./schema.js";

/** Build a Kysely instance backed by SQLite (`:memory:` for tests, a path for a file). */
export function makeSqlite(path = ":memory:"): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new SqliteDialect({ database: new SQLite(path) }),
  });
}

/**
 * Postgres seam. The whole backend is written against `Kysely<Database>` with
 * portable types (text/integer/real, JSON-as-text, app-generated ids), so
 * wiring Postgres is just swapping the dialect here. Left unwired to avoid a
 * hard `pg` dependency until a Postgres target is actually needed.
 */
export function makePostgres(_connectionString: string): Kysely<Database> {
  throw new Error(
    "Postgres dialect not wired yet: add `pg`, then construct a Kysely<Database> with PostgresDialect here.",
  );
}
