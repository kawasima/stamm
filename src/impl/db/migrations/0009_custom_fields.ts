import type { Kysely } from "kysely";

/**
 * Custom field definitions (the registry side of the EAV — see ADR-0003). The
 * *values* stay in issues.custom_fields (JSON text); only the definitions are
 * normalized here so they can be administered and used to validate writes.
 * possible_values / constraints / scope are JSON text; the boolean flags are
 * 0/1 integers (SQLite has no boolean).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("custom_field_definitions")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("field_type", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .addColumn("is_required", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("default_value", "text")
    .addColumn("possible_values", "text")
    .addColumn("constraints", "text", (c) => c.notNull())
    .addColumn("scope", "text", (c) => c.notNull())
    .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("is_filter", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("is_searchable", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("custom_field_definitions").execute();
}
