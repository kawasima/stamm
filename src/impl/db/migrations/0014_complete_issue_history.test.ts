import { describe, expect, it } from "vitest";
import { makeSqlite } from "../dialects.js";
import { migratorFor } from "../migrate.js";
import type { Kysely } from "kysely";

const to14 = async (db: Kysely<any>) => {
  const { error } = await migratorFor(db).migrateTo("0014_complete_issue_history");
  if (error) throw error;
};
const T = (d: number) => `2026-01-0${d}T00:00:00.000Z`;

/** A database as it was before 0014, holding what that version recorded. */
async function before() {
  const db = makeSqlite() as unknown as Kysely<any>;
  const { error } = await migratorFor(db).migrateTo("0013_project_code_of_conduct");
  if (error) throw error;
  let n = 0;
  const issue = async (id: string, statusId: string) =>
    db.insertInto("issues").values({ id, key: "p", number: ++n, project_id: "p", issue_type_id: "t", priority_id: "pr", status_id: statusId, subject: id, author_id: "author", visibility: "public", custom_fields: "[]" }).execute();
  const activity = (target: string, action: string, at: string, user = "author") =>
    db.insertInto("activity_entries").values({ id: `a${++n}`, project_id: "p", user_id: user, action, changes: "[]", occurred_at: at, target_type: "issue", target_id: target }).execute();
  const change = (id: string, issueId: string, from: string, to: string, at: string) =>
    db.insertInto("issue_status_changes").values({ id, issue_id: issueId, from_status_id: from, to_status_id: to, user_id: "mover", occurred_at: at }).execute();
  const history = async (issueId: string) =>
    (await db.selectFrom("issue_status_changes").selectAll().where("issue_id", "=", issueId).orderBy("occurred_at").orderBy("seq").execute())
      .map((r) => [r.from_status_id, r.to_status_id, r.occurred_at, r.user_id, r.seq]);
  return { db, issue, activity, change, history };
}

describe("0014 complete issue history", () => {
  it("records the initial status of issues that never moved, moved, or were deleted", async () => {
    const w = await before();
    await w.issue("still", "todo");
    await w.activity("still", "created", T(1));
    await w.issue("moved", "done");
    await w.activity("moved", "created", T(1));
    await w.change("c1", "moved", "doing", "done", T(3));
    await w.activity("gone", "created", T(1), "creator");
    await w.change("c2", "gone", "todo", "done", T(2));
    await w.activity("silent", "created", T(1));
    await to14(w.db);
    expect(await w.history("still")).toEqual([[null, "todo", T(1), "author", 1]]);
    expect(await w.history("moved")).toEqual([[null, "doing", T(1), "author", 1], ["doing", "done", T(3), "mover", 2]]);
    expect(await w.history("gone")).toEqual([[null, "todo", T(1), "creator", 1], ["todo", "done", T(2), "mover", 2]]);
    expect(await w.history("silent")).toEqual([]); // nothing says which status it had
  });

  it("orders changes made at one instant by what they lead to", async () => {
    const w = await before();
    await w.issue("i", "a");
    await w.activity("i", "created", T(1));
    // ids in the opposite order of the moves; the last one returns to the start
    await w.change("z", "i", "a", "b", T(1));
    await w.change("y", "i", "b", "c", T(1));
    await w.change("x", "i", "c", "d", T(1));
    await w.change("w", "i", "d", "a", T(2));
    await to14(w.db);
    expect((await w.history("i")).map((h) => h[1])).toEqual(["a", "b", "c", "d", "a"]);
  });

  it("numbers schedule and estimation changes per issue, and goes back down", async () => {
    const w = await before();
    await w.issue("i", "todo");
    await w.activity("i", "created", T(1));
    for (const [id, at] of [["s2", T(2)], ["s1", T(1)]] as const) {
      await w.db.insertInto("issue_schedule_changes").values({ id, issue_id: "i", user_id: "u", occurred_at: at }).execute();
    }
    await to14(w.db);
    expect((await w.db.selectFrom("issue_schedule_changes").select(["id", "seq"]).orderBy("seq").execute()).map((r) => [r.id, r.seq])).toEqual([["s1", 1], ["s2", 2]]);
    const { error } = await migratorFor(w.db).migrateTo("0013_project_code_of_conduct");
    expect(error).toBeUndefined();
    expect(await w.db.selectFrom("issue_status_changes").selectAll().execute()).toEqual([]);
    await w.activity("i", "updated", T(3)); // `changes` is back
    await to14(w.db);
    expect(await w.history("i")).toEqual([[null, "todo", T(1), "author", 1]]);
  });

  it("leaves the database as it was when it fails", async () => {
    const w = await before();
    await w.issue("i", "todo");
    await w.activity("i", "created", T(1));
    await w.db.schema.dropIndex("issue_estimation_changes_issue_idx").execute(); // makes a late step fail
    await expect(to14(w.db)).rejects.toThrow();
    expect(await w.db.selectFrom("issue_status_changes").selectAll().execute()).toEqual([]);
    await w.activity("i", "updated", T(2)); // `changes` is still there
  });
});
