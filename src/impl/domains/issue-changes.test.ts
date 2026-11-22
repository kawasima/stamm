import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { createSqlBehaviors } from "../index.js";
import { ensureBootstrapped } from "../bootstrap.js";
import type { KeyScope } from "../../schema/index.js";

const page = { pagination: { limit: 100 } };

async function world() {
  const db = await createTestDb();
  let clock = "2026-01-01T00:00:00.000Z";
  const now = () => clock;
  const b = createSqlBehaviors(db, { now });
  const seed = (await ensureBootstrapped(b))!;
  const admin = seed.adminId;
  const all = (await b.listRoles({ actorId: admin, ...page })).items[0]!;
  const own = await b.createRole({ actorId: admin, name: "Own", permissions: ["issue.create", "issue.delete"], issuesVisibility: "own_or_assigned" });
  const other = await b.createProject({ actorId: admin, identifier: "other", name: "Other" });
  const mk = async (login: string, ...in_: [string, string][]) => {
    const u = await b.createUser({ actorId: admin, login, email: `${login}@x.io`, displayName: login });
    for (const [projectId, roleId] of in_) await b.addProjectMember({ actorId: admin, projectId, userId: u.id, roleIds: [roleId] });
    return u.id;
  };
  const alice = await mk("alice", [seed.projectId, all.id], [other.id, all.id]);
  const limited = await mk("limited", [seed.projectId, own.id]);
  const outsider = await mk("outsider");
  const { todo, inProgress, done } = seed.statusIds;
  const create = (over: object = {}) =>
    b.createIssue({ actorId: alice, projectId: seed.projectId, issueTypeId: seed.issueTypeId, priorityId: seed.priorityId, subject: "S", ...over });
  const move = (issueId: string, toStatusId: string) => b.transitionIssueStatus({ actorId: admin, issueId, toStatusId });
  const changes = (actorId: string, over: object = {}, as = b) => as.listIssueChanges({ actorId, projectId: seed.projectId, ...page, ...over });
  const at = (t: string) => { clock = t; };
  const scoped = (scope: KeyScope) => createSqlBehaviors(db, { now, scope });
  return { db, b, seed, admin, alice, limited, outsider, other, todo, inProgress, done, create, move, changes, at, scoped };
}

describe("issue history", () => {
  it("is complete from creation, whatever the initial status", async () => {
    const w = await world();
    const i = await w.create({ statusId: w.inProgress });
    w.at("2026-01-02T00:00:00.000Z");
    await w.move(i.id, w.done);
    const { items } = await w.b.listIssueStatusHistory({ actorId: w.alice, issueId: i.id, ...page });
    expect(items.map((h) => [h.fromStatusId, h.toStatusId, h.occurredAt, h.userId])).toEqual([
      [undefined, w.inProgress, "2026-01-01T00:00:00.000Z", w.alice],
      [w.inProgress, w.done, "2026-01-02T00:00:00.000Z", w.admin],
    ]);
    const created = (await w.b.listActivities({ actorId: w.admin, targetId: i.id, action: "created", ...page })).items[0]!;
    expect(created.occurredAt).toBe(items[0]!.occurredAt);
  });

  it("keeps the order of changes that share an instant, across pages", async () => {
    const w = await world();
    const i = await w.create();
    const path = [w.inProgress, w.done, w.todo, w.inProgress, w.done, w.todo, w.done];
    for (const s of path) await w.move(i.id, s);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await w.b.listIssueStatusHistory({ actorId: w.alice, issueId: i.id, pagination: { limit: 2, ...(cursor ? { cursor } : {}) } });
      seen.push(...r.items.map((h) => h.toStatusId));
      cursor = r.nextCursor;
    } while (cursor);
    expect(seen).toEqual([w.todo, ...path]);
  });
});

describe("listIssueChanges", () => {
  it("returns every kind of change of a project in time order, with the same Events as the per-issue histories", async () => {
    const w = await world();
    const a = await w.create({ dueDate: "2026-02-01", estimatedHours: 3 });
    w.at("2026-01-02T00:00:00.000Z");
    const b = await w.create();
    w.at("2026-01-03T00:00:00.000Z");
    await w.move(a.id, w.done);
    const { items } = await w.changes(w.alice);
    expect(items.map((c) => c.occurredAt)).toEqual([...items.map((c) => c.occurredAt)].sort());
    expect(items.map((c) => [c.kind, c.issueId]).slice(-2)).toEqual([["status", b.id], ["status", a.id]]);
    expect(items.slice(0, 3).map((c) => c.kind).sort()).toEqual(["estimation", "schedule", "status"]);
    const status = items.filter((c) => c.kind === "status" && c.issueId === a.id).map(({ kind: _, ...e }) => e);
    expect(status).toEqual((await w.b.listIssueStatusHistory({ actorId: w.alice, issueId: a.id, ...page })).items);
    expect(items.find((c) => c.kind === "schedule")).toMatchObject({ toDueDate: "2026-02-01" });
    expect(items.find((c) => c.kind === "estimation")).toMatchObject({ toHours: 3 });
    expect(items[0]).not.toHaveProperty("seq");
  });

  it("filters by kind and by a half-open interval, whatever precision the instant has", async () => {
    const w = await world();
    await w.create({ dueDate: "2026-02-01" });
    w.at("2026-01-02T00:00:00.000Z");
    const b = await w.create();
    expect((await w.changes(w.alice, { kinds: ["schedule"] })).items.map((c) => c.kind)).toEqual(["schedule"]);
    expect((await w.changes(w.alice, { occurredFrom: "2026-01-02T00:00:00Z" })).items.map((c) => c.issueId)).toEqual([b.id]);
    expect((await w.changes(w.alice, { occurredUntil: "2026-01-02T00:00:00Z" })).items.every((c) => c.issueId !== b.id)).toBe(true);
  });

  it("pages through everything exactly once", async () => {
    const w = await world();
    for (let n = 0; n < 5; n++) await w.create({ dueDate: "2026-02-01" });
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await w.changes(w.alice, { pagination: { limit: 3, ...(cursor ? { cursor } : {}) } });
      ids.push(...r.items.map((c) => c.id));
      cursor = r.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it("follows an issue that moves to another project", async () => {
    const w = await world();
    const i = await w.create();
    await w.b.moveIssue({ actorId: w.alice, issueId: i.id, targetProjectId: w.other.id });
    expect((await w.changes(w.alice)).items).toEqual([]);
    expect((await w.changes(w.alice, { projectId: w.other.id })).items.map((c) => c.issueId)).toEqual([i.id]);
  });

  it("shows only what the reader could see issue by issue", async () => {
    const w = await world();
    const open = await w.create();
    const priv = await w.create({ visibility: "private" });
    const mine = await w.create({ actorId: w.limited });
    const seen = async (who: string, as = w.b) => new Set((await w.changes(who, {}, as)).items.map((c) => c.issueId));
    expect(await seen(w.alice)).toEqual(new Set([open.id, priv.id, mine.id]));
    expect(await seen(w.limited)).toEqual(new Set([mine.id]));
    expect(await seen(w.outsider)).toEqual(new Set([open.id, mine.id]));
    await w.b.setProjectVisibility({ actorId: w.admin, projectId: w.seed.projectId, visibility: "private" });
    await expect(w.changes(w.outsider)).rejects.toBeInstanceOf(NotFoundError);
    for (const who of [w.alice, w.admin]) {
      await expect(w.changes(who, {}, w.scoped({ projectIds: [w.other.id] }))).rejects.toBeInstanceOf(NotFoundError);
    }
    // a project-limited key is not an admin's, and this admin is not a member
    await expect(w.changes(w.admin, {}, w.scoped({ projectIds: [w.seed.projectId] }))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("a deleted issue's history", () => {
  const read = (w: Awaited<ReturnType<typeof world>>, who: string, id: string, as = w.b) => ({
    history: () => as.listIssueStatusHistory({ actorId: who, issueId: id, ...page }).then((r) => r.items.length),
    changes: () => w.changes(who, {}, as).then((r) => r.items.filter((c) => c.issueId === id).length),
    feed: () => as.listActivities({ actorId: who, projectId: w.seed.projectId, ...page }).then((r) => r.items.filter((e) => e.targetId === id).map((e) => e.action)),
  });

  it("stays readable to an admin and to a member who sees the whole project, and to no one else", async () => {
    const w = await world();
    for (const over of [{}, { visibility: "private" }, { actorId: w.limited }]) {
      const i = await w.create(over);
      await w.move(i.id, w.done);
      await w.b.deleteIssue({ actorId: w.admin, issueId: i.id });
      for (const who of [w.admin, w.alice]) {
        const r = read(w, who, i.id);
        expect(await r.history()).toBe(2);
        expect(await r.changes()).toBe(2);
        expect((await r.feed()).sort()).toEqual(["created", "deleted", "status_changed"]);
      }
      for (const who of [w.limited, w.outsider]) {
        const r = read(w, who, i.id);
        await expect(r.history()).rejects.toBeInstanceOf(NotFoundError);
        expect(await r.changes()).toBe(0);
        expect(await r.feed()).toEqual([]);
      }
      const r = read(w, w.alice, i.id, w.scoped({ projectIds: [w.other.id] }));
      await expect(r.history()).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("belongs to the project it was deleted from", async () => {
    const w = await world();
    const i = await w.create();
    await w.b.moveIssue({ actorId: w.alice, issueId: i.id, targetProjectId: w.other.id });
    await w.b.deleteIssue({ actorId: w.alice, issueId: i.id });
    expect((await w.changes(w.alice)).items).toEqual([]);
    expect((await w.changes(w.alice, { projectId: w.other.id })).items.map((c) => c.issueId)).toEqual([i.id]);
  });
});

describe("linked issues", () => {
  it("are left out of every listing when the reader can't see them", async () => {
    const w = await world();
    const secret = await w.create({ visibility: "private" });
    const open = await w.create();
    const child = await w.create({ visibility: "private" });
    await w.b.setIssueParent({ actorId: w.alice, childIssueId: open.id, parentIssueId: secret.id });
    await w.b.setIssueParent({ actorId: w.alice, childIssueId: child.id, parentIssueId: open.id });
    await w.b.createIssueRelation({ actorId: w.alice, issueId: open.id, relatedIssueId: secret.id, relationType: "relates_to" });
    const look = async (actorId: string) => {
      const row = (await w.b.listIssues({ actorId, filter: { projectId: w.seed.projectId }, include: ["parent", "relations"], ...page })).items.find((i) => i.id === open.id)!;
      const detail = await w.b.getIssueDetail({ actorId, issueId: open.id });
      return [
        row.parent?.id, row.relations!.length, detail.parent?.id, detail.relations.length,
        (await w.b.listChildIssues({ actorId, parentIssueId: open.id, ...page })).items.length,
        (await w.b.listIssueRelations({ actorId, issueId: open.id, ...page })).items.length,
      ];
    };
    expect(await look(w.alice)).toEqual([secret.id, 1, secret.id, 1, 1, 1]);
    expect(await look(w.outsider)).toEqual([undefined, 0, undefined, 0, 0, 0]);
  });
});

describe("deleting a status", () => {
  it("is refused while an issue, a history, a workflow or a default uses it", async () => {
    const w = await world();
    const i = await w.create();
    const del = (statusId: string) => w.b.deleteStatus({ actorId: w.admin, statusId });
    for (const s of [w.todo, w.inProgress, w.done]) await expect(del(s)).rejects.toBeInstanceOf(ConflictError);
    const past = await w.b.createStatus({ actorId: w.admin, name: "Past", category: "todo", sortOrder: 9 });
    await w.move(i.id, past.id);
    await expect(del(past.id)).rejects.toBeInstanceOf(ConflictError);
    await w.move(i.id, w.done);
    await w.b.deleteIssue({ actorId: w.admin, issueId: i.id });
    await expect(del(past.id)).rejects.toBeInstanceOf(ConflictError); // only history is left
    const unused = await w.b.createStatus({ actorId: w.admin, name: "Unused", category: "todo", sortOrder: 9 });
    await del(unused.id);
    await expect(del(unused.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
