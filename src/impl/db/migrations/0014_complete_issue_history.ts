import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { inTransaction } from "../../tx.js";

/**
 * Make each issue's recorded history complete and unambiguously ordered.
 *
 * - `seq`: an Event's position in its issue's history, for Events that share an instant.
 * - The initial status, which was not recorded on creation. It is the status the first
 *   change left, or the current one if there was none; it was entered when the issue
 *   was created, by its author. A deleted issue that never changed status left no
 *   trace of which one it had, so it gets none.
 * - `activity_entries.changes` was never written; the typed Events say what changed.
 */
const TABLES = ["issue_status_changes", "issue_schedule_changes", "issue_estimation_changes"] as const;

interface StatusRow { id: string; issue_id: string; from_status_id: string | null; to_status_id: string; user_id: string; occurred_at: string }

/** Put an issue's status changes in the order they happened: by time, and at one instant by following from -> to. */
export function inOrder(rows: StatusRow[]): StatusRow[] {
  const left = [...rows].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id < b.id ? -1 : 1));
  const out: StatusRow[] = [];
  while (left.length > 0) {
    const tied = left.filter((r) => r.occurred_at === left[0]!.occurred_at);
    const at = out.at(-1)?.to_status_id;
    // With nothing before, start from a status no tied change leads into.
    const next =
      (at === undefined
        ? tied.find((r) => r.from_status_id === null) ?? tied.find((r) => !tied.some((o) => o !== r && o.to_status_id === r.from_status_id))
        : tied.find((r) => r.from_status_id === at)) ?? tied[0]!;
    out.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return out;
}

// Kysely does not wrap SQLite migrations in a transaction. This one rewrites rows,
// so it does it itself: a failure leaves the database as it was.
export const up = (db: Kysely<any>): Promise<void> => inTransaction(db, upgrade);
export const down = (db: Kysely<any>): Promise<void> => inTransaction(db, downgrade);

async function upgrade(db: Kysely<any>): Promise<void> {
  for (const t of TABLES) await db.schema.alterTable(t).addColumn("seq", "integer", (c) => c.notNull().defaultTo(0)).execute();

  const groups = new Map<string, StatusRow[]>();
  for (const r of (await db.selectFrom("issue_status_changes").selectAll().execute()) as StatusRow[]) {
    groups.set(r.issue_id, [...(groups.get(r.issue_id) ?? []), r]);
  }
  const created = new Map<string, { occurred_at: string; user_id: string }>();
  for (const a of await db.selectFrom("activity_entries").select(["target_id", "user_id", "occurred_at"]).where("target_type", "=", "issue").where("action", "=", "created").execute()) {
    created.set(a.target_id as string, a as never);
  }
  const issues = new Map((await db.selectFrom("issues").select(["id", "status_id", "author_id"]).execute()).map((i) => [i.id as string, i as { status_id: string; author_id: string }]));

  for (const issueId of new Set([...issues.keys(), ...groups.keys()])) {
    const changes = inOrder(groups.get(issueId) ?? []);
    const issue = issues.get(issueId);
    const birth = created.get(issueId);
    const initial = changes.length > 0 ? changes[0]!.from_status_id : issue?.status_id;
    const userId = issue?.author_id ?? birth?.user_id;
    let seq = 1;
    // A null `from` on the first change means the initial status is already there.
    if (initial && birth && userId) {
      await db.insertInto("issue_status_changes").values({
        id: randomUUID(), issue_id: issueId, from_status_id: null, to_status_id: initial, user_id: userId, occurred_at: birth.occurred_at, seq: seq++,
      }).execute();
    }
    for (const c of changes) await db.updateTable("issue_status_changes").set({ seq: seq++ }).where("id", "=", c.id).execute();
  }

  for (const t of ["issue_schedule_changes", "issue_estimation_changes"]) {
    const at = new Map<string, number>();
    for (const r of await db.selectFrom(t).select(["id", "issue_id"]).orderBy("occurred_at").orderBy("id").execute()) {
      const seq = (at.get(r.issue_id) ?? 0) + 1;
      at.set(r.issue_id, seq);
      await db.updateTable(t).set({ seq }).where("id", "=", r.id).execute();
    }
  }

  for (const t of TABLES) {
    await db.schema.dropIndex(`${t}_issue_idx`).execute();
    await db.schema.createIndex(`${t}_issue_seq_unique`).on(t).columns(["issue_id", "seq"]).unique().execute();
    await db.schema.createIndex(`${t}_occurred_idx`).on(t).columns(["occurred_at", "seq", "id"]).execute();
  }
  await db.schema.alterTable("activity_entries").dropColumn("changes").execute();
}

/** Drops the recorded initial statuses: the earlier schema had none. */
async function downgrade(db: Kysely<any>): Promise<void> {
  await sql`alter table activity_entries add column changes text not null default '[]'`.execute(db);
  await db.deleteFrom("issue_status_changes").where("from_status_id", "is", null).execute();
  for (const t of TABLES) {
    await db.schema.dropIndex(`${t}_occurred_idx`).execute();
    await db.schema.dropIndex(`${t}_issue_seq_unique`).execute();
    await db.schema.createIndex(`${t}_issue_idx`).on(t).column("issue_id").execute();
    await db.schema.alterTable(t).dropColumn("seq").execute();
  }
}
