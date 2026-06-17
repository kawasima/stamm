import type { Kysely } from "kysely";

/**
 * Typed change-event tables for metrics, mirroring issue_status_changes. These
 * are append-only Events (one business-activity timestamp each): the current
 * value still lives on issue_schedules / issue_estimations (Resources), while
 * the change history lands here so due-date slippage and estimate accuracy are
 * reconstructable. Like the other event tables, they survive issue deletion.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("issue_schedule_changes")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("issue_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .addColumn("from_start_date", "text")
    .addColumn("to_start_date", "text")
    .addColumn("from_due_date", "text")
    .addColumn("to_due_date", "text")
    .execute();
  await db.schema.createIndex("issue_schedule_changes_issue_idx").on("issue_schedule_changes").column("issue_id").execute();

  await db.schema
    .createTable("issue_estimation_changes")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("issue_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .addColumn("from_hours", "real")
    .addColumn("to_hours", "real", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("issue_estimation_changes_issue_idx").on("issue_estimation_changes").column("issue_id").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("issue_estimation_changes").execute();
  await db.schema.dropTable("issue_schedule_changes").execute();
}
