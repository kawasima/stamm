import type { Kysely } from "kysely";

/**
 * Per-key scope (read-only / project-limited), stored as JSON text. "{}" means
 * unrestricted, so keys issued before this migration keep their full access.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("user_credentials")
    .addColumn("scope", "text", (c) => c.notNull().defaultTo("{}"))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("user_credentials").dropColumn("scope").execute();
}
