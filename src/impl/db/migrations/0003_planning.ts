import type { Kysely } from "kysely";

/** Milestones and iterations (planning containers issues are linked to). */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("milestones")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("start_date", "text")
    .addColumn("due_date", "text")
    .addColumn("release_date", "text")
    .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.createIndex("milestones_project_idx").on("milestones").column("project_id").execute();

  await db.schema
    .createTable("iterations")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("project_id", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("start_date", "text", (c) => c.notNull())
    .addColumn("end_date", "text", (c) => c.notNull())
    .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.createIndex("iterations_project_idx").on("iterations").column("project_id").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("iterations").execute();
  await db.schema.dropTable("milestones").execute();
}
