import type { Kysely } from "kysely";

/** Time entries (logged hours against a project, optionally an issue). */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("time_entries")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("issue_id", "text")
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("activity_id", "text", (c) => c.notNull())
    .addColumn("hours", "real", (c) => c.notNull())
    .addColumn("spent_on", "text", (c) => c.notNull())
    .addColumn("comment", "text")
    .execute();
  await db.schema.createIndex("time_entries_project_idx").on("time_entries").column("project_id").execute();
  await db.schema.createIndex("time_entries_issue_idx").on("time_entries").column("issue_id").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("time_entries").execute();
}
