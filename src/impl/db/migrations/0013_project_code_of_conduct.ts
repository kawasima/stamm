import type { Kysely } from "kysely";

/** A per-project Code of Conduct text, plus when it last changed. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("projects").addColumn("code_of_conduct", "text").execute();
  await db.schema.alterTable("projects").addColumn("code_of_conduct_updated_at", "text").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("projects").dropColumn("code_of_conduct_updated_at").execute();
  await db.schema.alterTable("projects").dropColumn("code_of_conduct").execute();
}
