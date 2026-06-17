import type { Kysely } from "kysely";

/**
 * Workspace authoring features layered on top of issues: draft issues (board
 * items not yet promoted), issue templates, saved views (queries), and the
 * per-view board card ordering. JSON-valued columns (filter, columns, the
 * template default_* arrays) are stored as text and (de)serialized by the codec.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("draft_issues")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("body", "text")
    .addColumn("author_id", "text", (c) => c.notNull())
    .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.createIndex("draft_issues_project_idx").on("draft_issues").column("project_id").execute();

  await db.schema
    .createTable("draft_conversions")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("draft_id", "text", (c) => c.notNull())
    .addColumn("issue_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("draft_conversions_draft_idx").on("draft_conversions").column("draft_id").execute();

  await db.schema
    .createTable("issue_templates")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("issue_type_id", "text")
    .addColumn("title_prefix", "text")
    .addColumn("description_template", "text", (c) => c.notNull())
    .addColumn("default_priority_id", "text")
    .addColumn("default_label_ids", "text")
    .addColumn("default_assignee_ids", "text")
    .addColumn("default_custom_fields", "text")
    .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.createIndex("issue_templates_project_idx").on("issue_templates").column("project_id").execute();

  await db.schema
    .createTable("project_views")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("layout", "text", (c) => c.notNull())
    .addColumn("filter", "text", (c) => c.notNull())
    .addColumn("group_by", "text")
    .addColumn("sort_by", "text")
    .addColumn("sort_direction", "text", (c) => c.notNull())
    .addColumn("columns", "text", (c) => c.notNull())
    .addColumn("visibility", "text", (c) => c.notNull())
    .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.createIndex("project_views_project_idx").on("project_views").column("project_id").execute();

  await db.schema
    .createTable("issue_board_positions")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("view_id", "text", (c) => c.notNull())
    .addColumn("issue_id", "text", (c) => c.notNull())
    .addColumn("position", "real", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("issue_board_positions_view_issue_idx").on("issue_board_positions").columns(["view_id", "issue_id"]).unique().execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("issue_board_positions").execute();
  await db.schema.dropTable("project_views").execute();
  await db.schema.dropTable("issue_templates").execute();
  await db.schema.dropTable("draft_conversions").execute();
  await db.schema.dropTable("draft_issues").execute();
}
