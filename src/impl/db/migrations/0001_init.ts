import type { Kysely } from "kysely";

/**
 * Initial schema. Column types stay portable across SQLite and Postgres:
 * text / integer / real, JSON-as-text, no DB-side autoincrement (ids are
 * app-generated). Grows as domains land.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("statuses")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("category", "text", (c) => c.notNull())
    .addColumn("color", "text")
    .addColumn("description", "text")
    .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable("priorities")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("color", "text")
    .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable("labels")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .addColumn("color", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("issue_types")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("color", "text")
    .addColumn("icon", "text")
    .addColumn("description", "text")
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable("categories")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("users")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("login", "text", (c) => c.notNull())
    .addColumn("email", "text", (c) => c.notNull())
    .addColumn("display_name", "text", (c) => c.notNull())
    .addColumn("avatar_url", "text")
    .addColumn("language", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("user_groups")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .execute();

  await db.schema
    .createTable("user_statuses")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "text", (c) => c.notNull().unique())
    .addColumn("status", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("group_memberships")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("group_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("group_memberships_unique")
    .on("group_memberships")
    .columns(["group_id", "user_id"])
    .unique()
    .execute();

  await db.schema
    .createTable("roles")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .addColumn("permissions", "text", (c) => c.notNull())
    .addColumn("issues_visibility", "text", (c) => c.notNull())
    .addColumn("builtin_kind", "text")
    .execute();

  await db.schema
    .createTable("projects")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("identifier", "text", (c) => c.notNull().unique())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .execute();

  await db.schema
    .createTable("project_categories")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull().unique())
    .addColumn("visibility", "text", (c) => c.notNull())
    .addColumn("lifecycle", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("project_hierarchies")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("parent_project_id", "text", (c) => c.notNull())
    .addColumn("child_project_id", "text", (c) => c.notNull().unique())
    .execute();

  await db.schema
    .createTable("project_memberships")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("project_memberships_unique")
    .on("project_memberships")
    .columns(["project_id", "user_id"])
    .unique()
    .execute();

  await db.schema
    .createTable("project_membership_roles")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("membership_id", "text", (c) => c.notNull())
    .addColumn("role_id", "text", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("project_membership_roles_unique")
    .on("project_membership_roles")
    .columns(["membership_id", "role_id"])
    .unique()
    .execute();

  await db.schema
    .createTable("workflow_transitions")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("issue_type_id", "text", (c) => c.notNull())
    .addColumn("from_status_id", "text", (c) => c.notNull())
    .addColumn("to_status_id", "text", (c) => c.notNull())
    .addColumn("role_ids", "text", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("workflow_transitions_scope_idx")
    .on("workflow_transitions")
    .columns(["project_id", "issue_type_id", "from_status_id"])
    .execute();

  await db.schema
    .createTable("default_status_settings")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("issue_type_id", "text", (c) => c.notNull())
    .addColumn("status_id", "text", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("default_status_settings_unique")
    .on("default_status_settings")
    .columns(["project_id", "issue_type_id"])
    .unique()
    .execute();

  await db.schema
    .createTable("activity_entries")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("action", "text", (c) => c.notNull())
    .addColumn("changes", "text", (c) => c.notNull())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .addColumn("target_type", "text", (c) => c.notNull())
    .addColumn("target_id", "text", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("activity_entries_target_idx")
    .on("activity_entries")
    .columns(["target_type", "target_id"])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("activity_entries").execute();
  await db.schema.dropTable("default_status_settings").execute();
  await db.schema.dropTable("workflow_transitions").execute();
  await db.schema.dropTable("project_membership_roles").execute();
  await db.schema.dropTable("project_memberships").execute();
  await db.schema.dropTable("group_memberships").execute();
  await db.schema.dropTable("user_statuses").execute();
  await db.schema.dropTable("project_hierarchies").execute();
  await db.schema.dropTable("project_categories").execute();
  await db.schema.dropTable("projects").execute();
  await db.schema.dropTable("user_groups").execute();
  await db.schema.dropTable("users").execute();
  await db.schema.dropTable("categories").execute();
  await db.schema.dropTable("issue_types").execute();
  await db.schema.dropTable("labels").execute();
  await db.schema.dropTable("priorities").execute();
  await db.schema.dropTable("roles").execute();
  await db.schema.dropTable("statuses").execute();
}
