import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { inTransaction } from "../../tx.js";

/**
 * Lists of ids move from JSON into rows with foreign keys (see 0015).
 *
 * An empty list of roles means anyone, and of projects or types means all of them. So
 * a listed project, type or role can't be deleted: dropping it from the list could
 * turn "only there" into "everywhere". A template's labels and assignees are
 * suggestions, and go with what they name.
 *
 * Drafts that were converted are removed: a draft lasts until it becomes an issue,
 * and the conversion is on record.
 */
interface Move { from: string; column: string; path?: string; table: string; owner: string; member: string; target: string; onDelete: "restrict" | "cascade" }
const MOVES: Move[] = [
  { from: "workflow_transitions", column: "role_ids", table: "workflow_transition_roles", owner: "transition_id", member: "role_id", target: "roles", onDelete: "restrict" },
  { from: "custom_field_definitions", column: "scope", path: "projectIds", table: "custom_field_projects", owner: "field_id", member: "project_id", target: "projects", onDelete: "restrict" },
  { from: "custom_field_definitions", column: "scope", path: "issueTypeIds", table: "custom_field_issue_types", owner: "field_id", member: "issue_type_id", target: "issue_types", onDelete: "restrict" },
  { from: "issue_templates", column: "default_label_ids", table: "issue_template_labels", owner: "template_id", member: "label_id", target: "labels", onDelete: "cascade" },
  { from: "issue_templates", column: "default_assignee_ids", table: "issue_template_assignees", owner: "template_id", member: "user_id", target: "users", onDelete: "cascade" },
];
const COLUMNS = [["workflow_transitions", "role_ids", true], ["custom_field_definitions", "scope", true], ["issue_templates", "default_label_ids", false], ["issue_templates", "default_assignee_ids", false]] as const;

const listIn = (raw: string | null, path?: string): string[] => {
  const parsed: unknown = raw === null ? [] : JSON.parse(raw);
  return ((path ? (parsed as Record<string, unknown>)[path] : parsed) as string[] | undefined) ?? [];
};

// See 0014: Kysely does not wrap SQLite migrations in a transaction.
export const up = (db: Kysely<any>): Promise<void> => inTransaction(db, upgrade);
export const down = (db: Kysely<any>): Promise<void> => inTransaction(db, downgrade);

async function upgrade(db: Kysely<any>): Promise<void> {
  for (const m of MOVES) {
    await db.schema.createTable(m.table)
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn(m.owner, "text", (c) => c.notNull().references(`${m.from}.id`).onDelete("cascade"))
      .addColumn(m.member, "text", (c) => c.notNull().references(`${m.target}.id`).onDelete(m.onDelete))
      .addColumn("position", "integer", (c) => c.notNull())
      .execute();
    await db.schema.createIndex(`${m.table}_unique`).on(m.table).columns([m.owner, m.member]).unique().execute();
    await db.schema.createIndex(`${m.table}_member_idx`).on(m.table).column(m.member).execute();

    const known = new Set((await db.selectFrom(m.target).select("id").execute()).map((r) => r.id as string));
    for (const row of await db.selectFrom(m.from).select(["id", m.column]).execute()) {
      const given = [...new Set(listIn(row[m.column] as string | null, m.path))];
      const kept = given.filter((id) => known.has(id));
      if (m.onDelete === "restrict" && given.length > 0 && kept.length === 0) {
        throw new Error(`${m.from} ${row.id as string} lists only ${m.target} that no longer exist. Dropping them would make it apply to all; edit or remove it and migrate again. Nothing was changed.`);
      }
      for (const [position, id] of kept.entries()) {
        await db.insertInto(m.table).values({ id: randomUUID(), [m.owner]: row.id, [m.member]: id, position }).execute();
      }
    }
  }
  for (const [table, column] of COLUMNS) await db.schema.alterTable(table).dropColumn(column).execute();
  await sql`delete from draft_issues where id in (select draft_id from draft_conversions)`.execute(db);
}

/** The drafts are not brought back. */
async function downgrade(db: Kysely<any>): Promise<void> {
  for (const [table, column, required] of COLUMNS) {
    await db.schema.alterTable(table).addColumn(column, "text", (c) => (required ? c.notNull().defaultTo(column === "scope" ? "{}" : "[]") : c)).execute();
  }
  for (const m of MOVES) {
    const lists = new Map<string, string[]>();
    for (const r of await db.selectFrom(m.table).selectAll().orderBy("position").execute()) lists.set(r[m.owner], [...(lists.get(r[m.owner]) ?? []), r[m.member]]);
    for (const [id, ids] of lists) {
      let value: unknown = ids;
      if (m.path) {
        const row = await db.selectFrom(m.from).select(m.column).where("id", "=", id).executeTakeFirstOrThrow();
        value = { ...(JSON.parse(row[m.column] as string) as object), [m.path]: ids };
      }
      await db.updateTable(m.from).set({ [m.column]: JSON.stringify(value) }).where("id", "=", id).execute();
    }
    await db.schema.dropTable(m.table).execute();
  }
}
