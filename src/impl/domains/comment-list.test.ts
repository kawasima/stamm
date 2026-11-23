import { describe, expect, it } from "vitest";
import { createTestDb } from "../test-db.js";
import { createSqlBehaviors } from "../index.js";
import { world as seen } from "../test-world.js";
import { ensureBootstrapped } from "../bootstrap.js";
import { NotFoundError, ValidationError } from "../errors.js";

const page = { pagination: { limit: 100 } };

/** Two issues under a parent, one elsewhere, and comments on them a minute apart. */
async function world() {
  let clock = Date.parse("2026-03-01T10:00:00.000Z");
  const b = createSqlBehaviors(await createTestDb(), { now: () => new Date(clock).toISOString() });
  const s = (await ensureBootstrapped(b))!;
  const actorId = s.adminId;
  const milestone = (await b.createMilestone({ actorId, projectId: s.projectId, name: "Release" })).id;
  const issue = async (subject: string, over: object = {}) => (await b.createIssue({ actorId, projectId: s.projectId, issueTypeId: s.issueTypeId, priorityId: s.priorityId, subject, ...over })).id;
  const parent = await issue("parent");
  const one = await issue("one", { parentIssueId: parent, milestoneId: milestone }), two = await issue("two", { parentIssueId: parent }), other = await issue("other");
  const say = async (issueId: string, body: string, who = actorId, visibility?: "private") => { clock += 60_000; return (await b.createComment({ actorId: who, issueId, body, ...(visibility ? { visibility } : {}) })).id; };
  await say(one, "通知のプレビューに住所が出る"); await say(other, "100% sure", s.memberId); await say(two, "確認した", s.memberId); await say(one, "a_b");
  const bodies = async (over: object) => (await b.listComments({ actorId, issues: {}, ...over, ...page })).items.map((c) => c.body);
  return { b, s, actorId, milestone, parent, one, two, other, bodies, say };
}

describe("listing comments", () => {
  it("goes across issues in the order written, either way", async () => {
    const w = await world();
    const all = ["通知のプレビューに住所が出る", "100% sure", "確認した", "a_b"];
    expect(await w.bodies({})).toEqual(all);
    expect(await w.bodies({ sortDirection: "desc" })).toEqual([...all].reverse());
  });

  it("is of the issues that match, as a search finds them", async () => {
    const w = await world();
    expect(await w.bodies({ issues: { parentIssueId: w.parent } })).toEqual(["通知のプレビューに住所が出る", "確認した", "a_b"]);
    expect(await w.bodies({ issues: { milestoneId: w.milestone } })).toEqual(["通知のプレビューに住所が出る", "a_b"]);
    expect(await w.bodies({ issues: { query: "other" } })).toEqual(["100% sure"]);
    expect(await w.bodies({ issues: { projectId: "none" } })).toEqual([]);
  });

  it("narrows by author, by text taken literally, and by time written, start included and end not", async () => {
    const w = await world();
    expect(await w.bodies({ authorIds: [w.s.memberId] })).toEqual(["100% sure", "確認した"]);
    expect(await w.bodies({ query: "住所" })).toEqual(["通知のプレビューに住所が出る"]);
    expect(await w.bodies({ query: "%" })).toEqual(["100% sure"]);
    expect(await w.bodies({ query: "_" })).toEqual(["a_b"]);
    expect(await w.bodies({ occurredFrom: "2026-03-01T10:02:00Z", occurredUntil: "2026-03-01T10:04:00Z" })).toEqual(["100% sure", "確認した"]);
    expect(await w.bodies({ issues: { parentIssueId: w.parent }, authorIds: [w.s.memberId], query: "確認" })).toEqual(["確認した"]);
  });

  it("says which issue each comment is on, the same for one issue as for many", async () => {
    const w = await world();
    const many = (await w.b.listComments({ actorId: w.actorId, issues: {}, query: "確認", ...page })).items;
    const i = await w.b.getIssue({ actorId: w.actorId, issueId: w.two });
    expect(many[0]).toMatchObject({ issueId: w.two, issue: { projectId: i.projectId, key: i.key, number: i.number, subject: "two" } });
    expect((await w.b.listComments({ actorId: w.actorId, issueId: w.two, ...page })).items).toEqual(many);
  });

  it("takes an issue or a filter, not both and not neither", async () => {
    const w = await world();
    await expect(w.b.listComments({ actorId: w.actorId, ...page })).rejects.toBeInstanceOf(ValidationError);
    await expect(w.b.listComments({ actorId: w.actorId, issueId: w.one, issues: {}, ...page })).rejects.toBeInstanceOf(ValidationError);
    await expect(w.b.listComments({ actorId: w.actorId, issueId: "none", ...page })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("pages across issues without skipping or repeating comments written at one instant", async () => {
    const b = createSqlBehaviors(await createTestDb(), { now: () => "2026-03-01T10:00:00.000Z" });
    const s = (await ensureBootstrapped(b))!;
    for (const subject of ["x", "y"]) {
      const { id } = await b.createIssue({ actorId: s.adminId, projectId: s.projectId, issueTypeId: s.issueTypeId, priorityId: s.priorityId, subject });
      for (let n = 0; n < 4; n++) await b.createComment({ actorId: s.adminId, issueId: id, body: `${subject}${n}` });
    }
    const got: string[] = [];
    let cursor: string | undefined;
    do {
      const p = await b.listComments({ actorId: s.adminId, issues: {}, pagination: { limit: 3, ...(cursor ? { cursor } : {}) } });
      got.push(...p.items.map((c) => c.body));
      cursor = p.nextCursor;
    } while (cursor);
    expect([...got].sort()).toEqual(["x0", "x1", "x2", "x3", "y0", "y1", "y2", "y3"]);
  });
});

describe("what a listing across issues leaves out", () => {
  const read = async (w: Awaited<ReturnType<typeof seen>>, actorId: string, over: object = {}, b = w.b) => (await b.listComments({ actorId, issues: {}, ...over, ...page })).items;

  it("is what the actor may not read: other projects, private issues, private comments", async () => {
    const w = await seen();
    expect((await read(w, w.outsider.id)).map((c) => c.body)).toEqual(["shown"]);
    expect(await read(w, w.outsider.id, { query: "HIDDENWORD" })).toEqual([]);
    expect(await read(w, w.limited.id)).toEqual([]);
    for (const who of [w.insider.id, w.A]) expect((await read(w, who)).length).toBe(4);
  });

  it("is everything outside the projects of a limited key", async () => {
    const w = await seen();
    const b = createSqlBehaviors(w.db, { scope: { projectIds: [w.pub] } });
    for (const who of [w.insider.id, w.A]) {
      const items = await read(w, who, {}, b);
      expect(items.length).toBeGreaterThan(0);
      expect(new Set(items.map((c) => c.issue.projectId))).toEqual(new Set([w.pub]));
      expect(await read(w, who, { issues: { projectId: w.priv } }, b)).toEqual([]);
    }
  });

  it("keeps a private comment for its author", async () => {
    const w = await seen();
    await w.db.updateTable("comments").set({ author_id: w.outsider.id }).where("id", "=", w.privateComment.id).execute();
    expect((await read(w, w.outsider.id)).map((c) => c.id)).toContain(w.privateComment.id);
  });
});
