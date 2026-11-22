import { describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import { makeSqlite } from "../dialects.js";
import { migrateToLatest, migratorFor } from "../migrate.js";
import { createSqlBehaviors } from "../../index.js";
import { ensureBootstrapped } from "../../bootstrap.js";

const schema = async (db: Kysely<any>) => (await sql<{ name: string; sql: string }>`select name, sql from sqlite_master where name not like 'sqlite%' and name not like 'kysely%' order by name`.execute(db)).rows;
const rows = async (db: Kysely<any>) => {
  const out: Record<string, unknown[]> = {};
  for (const t of (await schema(db)).filter((x) => x.sql?.startsWith("CREATE TABLE"))) out[t.name] = await db.selectFrom(t.name).selectAll().execute();
  return out;
};
const columns = async (db: Kysely<any>) => {
  const out: Record<string, unknown[]> = {};
  for (const t of (await schema(db)).filter((x) => x.sql?.startsWith("CREATE TABLE"))) {
    out[t.name] = (await sql`select name, type, "notnull", dflt_value, pk from pragma_table_info(${t.name})`.execute(db)).rows;
  }
  return out;
};
const to = async (db: Kysely<any>, name: string) => { const { error } = await migratorFor(db).migrateTo(name); if (error) throw error; };

async function filled() {
  const db = makeSqlite() as unknown as Kysely<any>;
  await migrateToLatest(db);
  const b = createSqlBehaviors(db as never);
  const s = (await ensureBootstrapped(b))!;
  await b.createIssue({ actorId: s.memberId, projectId: s.projectId, issueTypeId: s.issueTypeId, priorityId: s.priorityId, subject: "x", dueDate: "2026-02-01", estimatedHours: 2 });
  await to(db, "0015_foreign_keys");
  return { db, s };
}

describe("0015 foreign keys", () => {
  it("keeps every row, column and index, both ways", async () => {
    const { db } = await filled();
    const [r, c, i] = [await rows(db), await columns(db), (await schema(db)).filter((x) => /INDEX/i.test(x.sql ?? ""))];
    await to(db, "0014_complete_issue_history");
    expect(await rows(db)).toEqual(r);
    expect(await columns(db)).toEqual(c);
    expect((await sql`select * from pragma_foreign_key_list('issues')`.execute(db)).rows).toEqual([]);
    await to(db, "0015_foreign_keys");
    expect(await rows(db)).toEqual(r);
    expect(await columns(db)).toEqual(c);
    expect((await schema(db)).filter((x) => /INDEX/i.test(x.sql ?? ""))).toEqual(i);
    expect((await sql<{ foreign_keys: number }>`pragma foreign_keys`.execute(db)).rows[0]!.foreign_keys).toBe(1);
  });

  it("refuses a database with dangling references, says where, and changes nothing", async () => {
    const { db } = await filled();
    await to(db, "0014_complete_issue_history");
    await db.updateTable("issues").set({ priority_id: "gone" }).execute();
    const before = [await rows(db), await schema(db)];
    await expect(to(db, "0015_foreign_keys")).rejects.toThrow(/issues -> priorities/);
    expect([await rows(db), await schema(db)]).toEqual(before);
    expect((await sql<{ foreign_keys: number }>`pragma foreign_keys`.execute(db)).rows[0]!.foreign_keys).toBe(1);
  });
});
