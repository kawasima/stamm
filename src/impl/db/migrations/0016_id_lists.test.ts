import { describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { makeSqlite } from "../dialects.js";
import { migrateToLatest, migratorFor } from "../migrate.js";
import { createSqlBehaviors } from "../../index.js";
import { world } from "../../test-world.js";

const to = async (db: Kysely<any>, name: string) => { const { error } = await migratorFor(db).migrateTo(name); if (error) throw error; };
const BEFORE = "0015_foreign_keys";
const page = { pagination: { limit: 100 } };

async function before() {
  const db = makeSqlite() as unknown as Kysely<any>;
  await migrateToLatest(db);
  const w = await world(db as never);
  const f = await w.b.createCustomFieldDefinition({ actorId: w.A, name: "both", fieldType: "string", constraints: {}, scope: { projectIds: [w.priv, w.pub], issueTypeIds: [w.s.issueTypeId] } });
  await w.b.setWorkflowTransitions({ actorId: w.A, projectId: w.pub, issueTypeId: w.s.issueTypeId, transitions: [{ fromStatusId: w.s.statusIds.todo, toStatusId: w.s.statusIds.done, roleIds: [w.ids.roleId![1]!, w.ids.roleId![0]!] }] });
  const t = await w.b.createIssueTemplate({ actorId: w.A, projectId: w.pub, name: "t", descriptionTemplate: "", defaultLabelIds: [w.ids.labelId![0]!], defaultAssigneeIds: [w.insider.id] });
  const seen = async () => ({
    fields: (await w.b.listCustomFieldDefinitions({ actorId: w.A, ...page })).items,
    flow: (await w.b.listWorkflowTransitions({ actorId: w.A, projectId: w.pub })).transitions,
    template: await w.b.getIssueTemplate({ actorId: w.A, templateId: t.id }),
  });
  return { db, w, f, t, seen };
}

describe("0016 id lists", () => {
  it("keeps every list and its order, both ways", async () => {
    const { db, f, seen } = await before();
    const was = await seen();
    await to(db, BEFORE);
    const row = await db.selectFrom("custom_field_definitions").select("scope").where("id", "=", f.id).executeTakeFirst();
    expect(JSON.parse(row!.scope)).toEqual(was.fields.find((x) => x.id === f.id)!.scope);
    await migrateToLatest(db);
    expect(await seen()).toEqual(was);
  });

  it("drops a listed id that is gone, where that changes nothing", async () => {
    const { db, w, f, t, seen } = await before();
    await to(db, BEFORE);
    await db.updateTable("custom_field_definitions").set({ scope: JSON.stringify({ projectIds: ["gone", w.pub] }) }).where("id", "=", f.id).execute();
    await db.updateTable("issue_templates").set({ default_label_ids: JSON.stringify(["gone"]) }).where("id", "=", t.id).execute();
    await migrateToLatest(db);
    const now = await seen();
    expect(now.fields.find((x) => x.id === f.id)!.scope).toEqual({ projectIds: [w.pub] });
    expect(now.template.defaultLabelIds).toBeUndefined();
  });

  it("stops, changing nothing, where dropping it would make something apply to all", async () => {
    for (const [table, column, value] of [["custom_field_definitions", "scope", '{"projectIds":["gone"]}'], ["custom_field_definitions", "scope", '{"issueTypeIds":["gone"]}'], ["workflow_transitions", "role_ids", '["gone"]']] as const) {
      const { db } = await before();
      await to(db, BEFORE);
      const first = await db.selectFrom(table).select("id").executeTakeFirst();
      await db.updateTable(table).set({ [column]: value }).where("id", "=", first!.id).execute();
      const rows = await db.selectFrom(table).selectAll().execute();
      await expect(migrateToLatest(db), column).rejects.toThrow(/no longer exist/);
      expect(await db.selectFrom(table).selectAll().execute()).toEqual(rows);
    }
  });

  it("removes drafts that were already converted, and no others", async () => {
    const { db, w } = await before();
    const b = createSqlBehaviors(db as never);
    const d = await b.createDraftIssue({ actorId: w.A, projectId: w.pub, title: "kept on" });
    await db.insertInto("draft_conversions").values({ id: "c", draft_id: d.id, issue_id: w.shown.id, user_id: w.A, occurred_at: "2026-01-01T00:00:00.000Z" }).execute();
    const others = (await b.listDraftIssues({ actorId: w.A, projectId: w.pub, ...page })).items.map((x) => x.id).filter((x) => x !== d.id);
    await to(db, BEFORE);
    await migrateToLatest(db);
    expect((await b.listDraftIssues({ actorId: w.A, projectId: w.pub, ...page })).items.map((x) => x.id)).toEqual(others);
  });
});
