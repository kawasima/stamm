import type { Kysely } from "kysely";

/** Notifications and their separate read events. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("notifications")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("recipient_id", "text", (c) => c.notNull())
    .addColumn("event_type", "text", (c) => c.notNull())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .addColumn("target_type", "text", (c) => c.notNull())
    .addColumn("target_id", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("notifications_recipient_idx").on("notifications").column("recipient_id").execute();

  await db.schema
    .createTable("notification_reads")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("notification_id", "text", (c) => c.notNull().unique())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("notification_reads").execute();
  await db.schema.dropTable("notifications").execute();
}
