import { sql, SqliteAdapter, type Kysely } from "kysely";

/**
 * Declare what refers to what, so that the database refuses a reference to something
 * that does not exist and the deletion of something that is referred to.
 *
 * - `restrict`: the referring row has no meaning without it. It can't be deleted.
 * - `cascade`: the referring row is part of it, or only links to it. It goes with it.
 *
 * Not declared, on purpose: the issue an Event is about and the project of an
 * activity entry (Events outlive Resources), and targets named by type and id.
 */
type Ref = readonly [column: string, target: string, onDelete: "restrict" | "cascade"];
export const REFERENCES: Record<string, readonly Ref[]> = {
  // what an issue is
  issues: [["project_id", "projects", "restrict"], ["issue_type_id", "issue_types", "restrict"], ["priority_id", "priorities", "restrict"], ["status_id", "statuses", "restrict"], ["author_id", "users", "restrict"]],
  // what happened: who did it and the statuses it names stay
  issue_status_changes: [["from_status_id", "statuses", "restrict"], ["to_status_id", "statuses", "restrict"], ["user_id", "users", "restrict"]],
  issue_schedule_changes: [["user_id", "users", "restrict"]],
  issue_estimation_changes: [["user_id", "users", "restrict"]],
  activity_entries: [["user_id", "users", "restrict"]],
  comments: [["author_id", "users", "restrict"]],
  attachments: [["author_id", "users", "restrict"]],
  time_entries: [["project_id", "projects", "restrict"], ["user_id", "users", "restrict"]],
  draft_conversions: [["user_id", "users", "restrict"]],
  // what an issue has now
  issue_assignees: [["issue_id", "issues", "cascade"], ["assignee_id", "users", "restrict"]],
  issue_labels: [["issue_id", "issues", "cascade"], ["label_id", "labels", "cascade"]],
  issue_categories: [["issue_id", "issues", "cascade"], ["category_id", "categories", "cascade"]],
  issue_milestones: [["issue_id", "issues", "cascade"], ["milestone_id", "milestones", "cascade"]],
  issue_iterations: [["issue_id", "issues", "cascade"], ["iteration_id", "iterations", "cascade"]],
  issue_watchers: [["issue_id", "issues", "cascade"], ["user_id", "users", "cascade"]],
  issue_parents: [["child_issue_id", "issues", "cascade"], ["parent_issue_id", "issues", "cascade"]],
  issue_relations: [["issue_id", "issues", "cascade"], ["related_issue_id", "issues", "cascade"]],
  issue_schedules: [["issue_id", "issues", "cascade"]],
  issue_estimations: [["issue_id", "issues", "cascade"]],
  issue_progress: [["issue_id", "issues", "cascade"]],
  issue_board_positions: [["view_id", "project_views", "cascade"], ["issue_id", "issues", "cascade"]],
  // what a project is made of; unfinished work in it (drafts) keeps it
  project_categories: [["project_id", "projects", "cascade"]],
  project_hierarchies: [["parent_project_id", "projects", "cascade"], ["child_project_id", "projects", "cascade"]],
  project_memberships: [["project_id", "projects", "cascade"], ["user_id", "users", "cascade"]],
  project_membership_roles: [["membership_id", "project_memberships", "cascade"], ["role_id", "roles", "restrict"]],
  labels: [["project_id", "projects", "cascade"]],
  categories: [["project_id", "projects", "cascade"]],
  milestones: [["project_id", "projects", "cascade"]],
  iterations: [["project_id", "projects", "cascade"]],
  project_views: [["project_id", "projects", "cascade"], ["owner_id", "users", "restrict"]],
  issue_templates: [["project_id", "projects", "cascade"], ["issue_type_id", "issue_types", "restrict"], ["default_priority_id", "priorities", "restrict"]],
  draft_issues: [["project_id", "projects", "restrict"], ["author_id", "users", "restrict"]],
  workflow_transitions: [["project_id", "projects", "cascade"], ["issue_type_id", "issue_types", "restrict"], ["from_status_id", "statuses", "restrict"], ["to_status_id", "statuses", "restrict"]],
  default_status_settings: [["project_id", "projects", "cascade"], ["issue_type_id", "issue_types", "restrict"], ["status_id", "statuses", "restrict"]],
  // what a user is
  user_credentials: [["user_id", "users", "cascade"]],
  user_statuses: [["user_id", "users", "cascade"]],
  group_memberships: [["group_id", "user_groups", "cascade"], ["user_id", "users", "cascade"]],
  notifications: [["recipient_id", "users", "cascade"]],
  notification_reads: [["notification_id", "notifications", "cascade"]],
};

const isSqlite = (db: Kysely<any>): boolean => db.getExecutor().adapter instanceof SqliteAdapter;
const q = (name: string): string => `"${name}"`;
const clause = ([column, target, onDelete]: Ref): string => `foreign key (${q(column)}) references ${q(target)} ("id") on delete ${onDelete}`;

/** SQLite can't add a constraint to a table: make the table again, with or without them. */
async function rebuild(db: Kysely<any>, withKeys: boolean): Promise<void> {
  // Must be off while tables are replaced, and can't be changed inside a transaction.
  await sql`pragma foreign_keys = off`.execute(db);
  try {
    await db.transaction().execute(async (trx) => {
      for (const [table, refs] of Object.entries(REFERENCES)) {
        const { rows: cols } = await sql<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>`select * from pragma_table_info(${table})`.execute(trx);
        const { rows: indexes } = await sql<{ sql: string }>`select sql from sqlite_master where type = 'index' and tbl_name = ${table} and sql is not null`.execute(trx);
        const defs = cols.map((c) => `${q(c.name)} ${c.type}${c.pk ? " primary key" : ""}${c.notnull ? " not null" : ""}${c.dflt_value !== null ? ` default ${c.dflt_value}` : ""}`);
        const names = cols.map((c) => q(c.name)).join(", ");
        const temp = `${table}__0015`;
        await sql.raw(`create table ${q(temp)} (${[...defs, ...(withKeys ? refs.map(clause) : [])].join(", ")})`).execute(trx);
        await sql.raw(`insert into ${q(temp)} (${names}) select ${names} from ${q(table)}`).execute(trx);
        await sql.raw(`drop table ${q(table)}`).execute(trx);
        await sql.raw(`alter table ${q(temp)} rename to ${q(table)}`).execute(trx);
        for (const i of indexes) await sql.raw(i.sql).execute(trx);
      }
      if (withKeys) {
        const { rows } = await sql<{ table: string; parent: string }>`select "table", parent from pragma_foreign_key_check`.execute(trx);
        if (rows.length > 0) {
          const found = [...new Set(rows.map((r) => `${r.table} -> ${r.parent}`))].join(", ");
          throw new Error(`The database refers to rows that do not exist (${found}). Repair them and migrate again; nothing was changed.`);
        }
      }
    });
  } finally {
    await sql`pragma foreign_keys = on`.execute(db);
  }
}

const nameOf = (table: string, column: string): string => `${table}_${column}_fk`;

export async function up(db: Kysely<any>): Promise<void> {
  if (isSqlite(db)) return rebuild(db, true);
  for (const [table, refs] of Object.entries(REFERENCES)) {
    for (const [column, target, onDelete] of refs) {
      await db.schema.alterTable(table).addForeignKeyConstraint(nameOf(table, column), [column], target, ["id"]).onDelete(onDelete).execute();
    }
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  if (isSqlite(db)) return rebuild(db, false);
  for (const [table, refs] of Object.entries(REFERENCES)) {
    for (const [column] of refs) await db.schema.alterTable(table).dropConstraint(nameOf(table, column)).execute();
  }
}
