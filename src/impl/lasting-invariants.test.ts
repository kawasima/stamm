import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import { world } from "./test-world.js";

const page = { pagination: { limit: 100 } };

/** What holds when something is written must still hold after what it rests on changes. */
describe("leaving a project", () => {
  it("takes the member off its issues, on record, and off no other project's", async () => {
    const w = await world();
    const { b, A, pub, priv } = w;
    await b.removeProjectMember({ actorId: A, projectId: pub, userId: w.insider.id });
    const who = async (issueId: string) => (await b.getIssueDetail({ actorId: A, issueId })).assignees.map((a) => a.id);
    expect(await who(w.shown.id)).toEqual([]);
    expect(await who(w.privateIssue.id)).toEqual([]);
    expect(await who(w.inPriv.id)).toEqual([w.insider.id]);
    const feed = (await b.listActivities({ actorId: A, projectId: pub, action: "assigned", targetId: w.shown.id, ...page })).items;
    expect(feed.some((e) => e.userId === A)).toBe(true);
    expect((await b.listActivities({ actorId: A, projectId: priv, action: "assigned", ...page })).items.some((e) => e.userId === A)).toBe(false);
  });
});

describe("notifications", () => {
  const inbox = async (w: Awaited<ReturnType<typeof world>>, id: string) => (await w.b.listNotifications({ actorId: w.A, recipientId: id, ...page })).items.length;

  it("stop for a watcher who can no longer read the issue, and go on for one who can", async () => {
    const w = await world();
    const { b, A, pub } = w;
    await b.watchIssue({ actorId: w.outsider.id, issueId: w.shown.id });
    await b.createComment({ actorId: A, issueId: w.shown.id, body: "one" });
    expect(await inbox(w, w.outsider.id)).toBe(1);
    const before = await inbox(w, w.insider.id);
    await b.setProjectVisibility({ actorId: A, projectId: pub, visibility: "private" });
    await b.createComment({ actorId: A, issueId: w.shown.id, body: "two" });
    await b.transitionIssueStatus({ actorId: A, issueId: w.shown.id, toStatusId: w.s.statusIds.done });
    expect(await inbox(w, w.outsider.id)).toBe(1);
    expect(await inbox(w, w.insider.id)).toBeGreaterThan(before);
  });

  it("of a private comment go to members only", async () => {
    const w = await world();
    await w.b.watchIssue({ actorId: w.outsider.id, issueId: w.shown.id });
    const before = await inbox(w, w.insider.id);
    await w.b.createComment({ actorId: w.A, issueId: w.shown.id, body: "x", visibility: "private" });
    expect(await inbox(w, w.outsider.id)).toBe(0);
    expect(await inbox(w, w.insider.id)).toBe(before + 1);
  });

  it("reach whoever can read the issue, whatever key wrote it", async () => {
    const w = await world();
    const { createSqlBehaviors } = await import("./index.js");
    const scoped = createSqlBehaviors(w.db, { scope: { projectIds: [w.pub] } });
    await w.b.watchIssue({ actorId: w.A, issueId: w.shown.id }); // an admin who is not a member
    await scoped.createComment({ actorId: w.insider.id, issueId: w.shown.id, body: "x" });
    expect(await inbox(w, w.A)).toBeGreaterThan(0);
  });
});

describe("custom field values", () => {
  async function valued() {
    const w = await world();
    const { b, A, pub, priv, s } = w;
    const field = (over: object) => b.createCustomFieldDefinition({ actorId: A, name: "f", fieldType: "string", constraints: {}, scope: {}, ...over });
    const here = await field({ scope: { projectIds: [pub] } });
    const set = (fieldId: string, value: string | string[] | number) => b.updateIssue({ actorId: A, issueId: w.shown.id, customFields: [{ fieldId, value }] });
    return { w, b, A, pub, priv, s, field, here, set, get: () => b.getIssue({ actorId: A, issueId: w.shown.id }) };
  }

  it("are not left behind by a move: it is refused until they are cleared", async () => {
    const { b, A, priv, here, set, get, w } = await valued();
    await set(here.id, "x");
    await expect(b.moveIssue({ actorId: A, issueId: w.shown.id, targetProjectId: priv })).rejects.toBeInstanceOf(ValidationError);
    expect((await get()).projectId).toBe(w.pub);
    await b.updateIssue({ actorId: A, issueId: w.shown.id, customFields: [] });
    await b.moveIssue({ actorId: A, issueId: w.shown.id, targetProjectId: priv });
  });

  it("are checked when the issue's type changes", async () => {
    const { b, A, s, field, set, w } = await valued();
    const other = await b.createIssueType({ actorId: A, name: "Other" });
    const typed = await field({ scope: { issueTypeIds: [s.issueTypeId] } });
    await set(typed.id, "x");
    await expect(b.updateIssue({ actorId: A, issueId: w.shown.id, issueTypeId: other.id })).rejects.toBeInstanceOf(ValidationError);
    await b.updateIssue({ actorId: A, issueId: w.shown.id, issueTypeId: other.id, customFields: [] });
  });

  it("keep their definition from changing into one they contradict", async () => {
    const { b, A, priv, s, field, set } = await valued();
    const f = await field({ fieldType: "list", possibleValues: ["a", "b"] });
    await set(f.id, "a");
    const change = (over: object) => b.updateCustomFieldDefinition({ actorId: A, fieldId: f.id, ...over });
    const other = await b.createIssueType({ actorId: A, name: "Other" });
    for (const over of [{ fieldType: "integer" }, { possibleValues: ["b"] }, { scope: { projectIds: [priv] } }, { scope: { issueTypeIds: [other.id] } }]) {
      await expect(change(over), JSON.stringify(over)).rejects.toBeInstanceOf(ConflictError);
    }
    expect(await b.getCustomFieldDefinition({ actorId: A, fieldId: f.id })).toMatchObject({ fieldType: "list", possibleValues: ["a", "b"] });
    await change({ possibleValues: ["a", "c"], name: "renamed", scope: { issueTypeIds: [s.issueTypeId] }, isRequired: true });
  });
});

describe("what can be read and written", () => {
  it("lets a member with a narrow role go on with their own issues", async () => {
    const w = await world();
    const at = { actorId: w.limited.id, issueId: w.ofLimited.id };
    await w.b.updateIssue({ ...at, subject: "x" });
    await w.b.createComment({ ...at, body: "x" });
    await w.b.setIssueEstimation({ ...at, estimatedHours: 1 });
    const t = await w.b.createTimeEntry({ actorId: w.limited.id, projectId: w.pub, issueId: w.ofLimited.id, userId: w.limited.id, activityId: "dev", hours: 1, spentOn: "2026-01-01" });
    expect((await w.b.listTimeEntries({ actorId: w.limited.id, projectId: w.pub, ...page })).items.map((e) => e.id)).toContain(t.id);
    await w.b.deleteIssue(at);
    expect((await w.b.getTimeEntry({ actorId: w.limited.id, timeEntryId: t.id })).id).toBe(t.id); // one's own time stays one's own
  });

  it("still tells a lacking permission from a lacking issue", async () => {
    const w = await world();
    await expect(w.b.createComment({ actorId: w.outsider.id, issueId: w.shown.id, body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.b.createComment({ actorId: w.outsider.id, issueId: w.privateIssue.id, body: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("sums time and progress over what the reader can see", async () => {
    const w = await world();
    const m = w.ids.milestoneId![0]!;
    for (const i of [w.shown.id, w.privateIssue.id]) await w.b.setIssueMilestone({ actorId: w.A, issueId: i, milestoneId: m });
    const total = async (actorId: string) => (await w.b.getMilestoneProgress({ actorId, milestoneId: m })).totalIssues;
    expect([await total(w.A), await total(w.insider.id), await total(w.outsider.id)]).toEqual([2, 2, 1]);
    const hours = async (actorId: string) => (await w.b.getTimeSummary({ actorId, projectId: w.pub, groupBy: "project" })).totalHours;
    expect(await hours(w.A)).toBe(4); // shown, private, deleted, and one on no issue
    expect(await hours(w.outsider.id)).toBe(2);
  });
});
