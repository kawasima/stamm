import type { Kysely } from "kysely";

/** Issues, their status-change history, satellites, and relations. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("issues")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("key", "text", (c) => c.notNull())
    .addColumn("number", "integer", (c) => c.notNull())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("issue_type_id", "text", (c) => c.notNull())
    .addColumn("priority_id", "text", (c) => c.notNull())
    .addColumn("status_id", "text", (c) => c.notNull())
    .addColumn("subject", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .addColumn("author_id", "text", (c) => c.notNull())
    .addColumn("visibility", "text", (c) => c.notNull())
    .addColumn("custom_fields", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("issues_project_number_unique").on("issues").columns(["project_id", "number"]).unique().execute();

  await db.schema
    .createTable("issue_status_changes")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("issue_id", "text", (c) => c.notNull())
    .addColumn("from_status_id", "text")
    .addColumn("to_status_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("issue_status_changes_issue_idx").on("issue_status_changes").column("issue_id").execute();

  // N:N satellites (unique on the pair to prevent duplicates)
  for (const [table, col] of [
    ["issue_assignees", "assignee_id"],
    ["issue_labels", "label_id"],
    ["issue_watchers", "user_id"],
  ] as const) {
    await db.schema
      .createTable(table)
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("issue_id", "text", (c) => c.notNull())
      .addColumn(col, "text", (c) => c.notNull())
      .execute();
    await db.schema.createIndex(`${table}_unique`).on(table).columns(["issue_id", col]).unique().execute();
  }

  // 0..1 satellites (unique on issue_id)
  await db.schema
    .createTable("issue_categories")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("issue_id", "text", (c) => c.notNull().unique())
    .addColumn("category_id", "text", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("issue_milestones")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("issue_id", "text", (c) => c.notNull().unique())
    .addColumn("milestone_id", "text", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("issue_parents")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("child_issue_id", "text", (c) => c.notNull().unique())
    .addColumn("parent_issue_id", "text", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("issue_schedules")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("issue_id", "text", (c) => c.notNull().unique())
    .addColumn("start_date", "text")
    .addColumn("due_date", "text")
    .execute();
  await db.schema
    .createTable("issue_estimations")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("issue_id", "text", (c) => c.notNull().unique())
    .addColumn("estimated_hours", "real", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("issue_progress")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("issue_id", "text", (c) => c.notNull().unique())
    .addColumn("done_ratio", "integer", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("issue_iterations")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("issue_id", "text", (c) => c.notNull().unique())
    .addColumn("iteration_id", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("issue_relations")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("issue_id", "text", (c) => c.notNull())
    .addColumn("related_issue_id", "text", (c) => c.notNull())
    .addColumn("relation_type", "text", (c) => c.notNull())
    .addColumn("delay", "integer")
    .execute();
  await db.schema.createIndex("issue_relations_issue_idx").on("issue_relations").column("issue_id").execute();

  await db.schema
    .createTable("comments")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .addColumn("issue_id", "text", (c) => c.notNull())
    .addColumn("author_id", "text", (c) => c.notNull())
    .addColumn("body", "text", (c) => c.notNull())
    .addColumn("visibility", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("comments_issue_idx").on("comments").column("issue_id").execute();

  await db.schema
    .createTable("attachments")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .addColumn("target_type", "text", (c) => c.notNull())
    .addColumn("target_id", "text", (c) => c.notNull())
    .addColumn("filename", "text", (c) => c.notNull())
    .addColumn("content_type", "text", (c) => c.notNull())
    .addColumn("size_bytes", "integer", (c) => c.notNull())
    .addColumn("author_id", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .addColumn("storage_key", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("attachments_target_idx").on("attachments").columns(["target_type", "target_id"]).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const t of [
    "attachments", "comments",
    "issue_relations", "issue_iterations", "issue_progress", "issue_estimations", "issue_schedules",
    "issue_parents", "issue_watchers", "issue_milestones", "issue_categories", "issue_labels",
    "issue_assignees", "issue_status_changes", "issues",
  ]) {
    await db.schema.dropTable(t).execute();
  }
}
