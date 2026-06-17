import { describe, it, expect } from "vitest";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { issueBehaviors } from "./issue.js";

function steppingClock(): () => string {
  let t = Date.parse("2026-01-01T00:00:00.000Z");
  return () => {
    const s = new Date(t).toISOString();
    t += 1000;
    return s;
  };
}
function countingIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db, { now: steppingClock(), genId: countingIds() });
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const issues = issueBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "admin@x.io", displayName: "Admin", kind: "admin" });
  const memberRole = await config.createRole({ actorId: admin.id, name: "Member", permissions: ["issue.create", "issue.update", "issue.delete", "issue.move"], issuesVisibility: "all" });
  const viewerRole = await config.createRole({ actorId: admin.id, name: "Viewer", permissions: [], issuesVisibility: "own_or_assigned" });
  const todo = await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "alice@x.io", displayName: "Alice" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [memberRole.id] });

  const base = { issueTypeId: type.id, priorityId: priority.id };
  return { db, ctx, config, project, issues, admin, memberRole, viewerRole, todo, priority, type, proj, alice, base };
}

async function worldWithWorkflow() {
  const w = await world();
  const doing = await w.config.createStatus({ actorId: w.admin.id, name: "Doing", category: "in_progress", sortOrder: 1 });
  const wf = (await import("./workflow-config.js")).workflowConfigBehaviors(w.ctx);
  await wf.setWorkflowTransitions({
    actorId: w.admin.id,
    projectId: w.proj.id,
    issueTypeId: w.type.id,
    transitions: [{ fromStatusId: w.todo.id, toStatusId: doing.id, roleIds: [w.memberRole.id] }],
  });
  return { ...w, doing };
}

describe("issue domain — create & reads", () => {
  it("allocates a per-project number, resolves the default (todo) status, and reads back", async () => {
    const w = await world();
    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "Bug 1" });
    expect(issue).toMatchObject({ key: "proj", number: 1, statusId: w.todo.id, authorId: w.alice.id, visibility: "public" });

    const i2 = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "Bug 2" });
    expect(i2.number).toBe(2);

    expect(await w.issues.getIssue({ actorId: w.alice.id, issueId: issue.id })).toMatchObject({ id: issue.id, number: 1 });
    expect(await w.issues.getIssueByKey({ actorId: w.alice.id, key: "proj-2" })).toMatchObject({ id: i2.id });
    await w.db.destroy();
  });

  it("numbers restart per project", async () => {
    const w = await world();
    await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "A" });
    const proj2 = await w.project.createProject({ actorId: w.admin.id, identifier: "proj2", name: "P2" });
    await w.project.addProjectMember({ actorId: w.admin.id, projectId: proj2.id, userId: w.alice.id, roleIds: [w.memberRole.id] });
    const first = await w.issues.createIssue({ actorId: w.alice.id, projectId: proj2.id, ...w.base, subject: "first" });
    expect(first.number).toBe(1);
    await w.db.destroy();
  });

  it("getIssueDetail hydrates compound fields set at creation", async () => {
    const w = await world();
    const issue = await w.issues.createIssue({
      actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "S",
      assigneeIds: [w.alice.id], dueDate: "2026-07-01", estimatedHours: 4,
    });
    const detail = await w.issues.getIssueDetail({ actorId: w.alice.id, issueId: issue.id });
    expect(detail.assignees.map((a) => a.id)).toEqual([w.alice.id]);
    expect(detail.schedule?.dueDate).toBe("2026-07-01");
    expect(detail.estimation?.estimatedHours).toBe(4);
    expect(detail.labels).toEqual([]);
    await w.db.destroy();
  });

  it("rejects creation by a non-member with ForbiddenError", async () => {
    const w = await world();
    const bob = await w.config.createUser({ actorId: w.admin.id, login: "bob", email: "bob@x.io", displayName: "Bob" });
    await expect(
      w.issues.createIssue({ actorId: bob.id, projectId: w.proj.id, ...w.base, subject: "X" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });

  it("scopes reads: an own_or_assigned viewer cannot see another's issue, a global admin can", async () => {
    const w = await world();
    const carol = await w.config.createUser({ actorId: w.admin.id, login: "carol", email: "c@x.io", displayName: "Carol" });
    await w.project.addProjectMember({ actorId: w.admin.id, projectId: w.proj.id, userId: carol.id, roleIds: [w.viewerRole.id] });

    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "Alice's" });
    await expect(w.issues.getIssue({ actorId: carol.id, issueId: issue.id })).rejects.toBeInstanceOf(NotFoundError);
    expect(await w.issues.getIssue({ actorId: w.admin.id, issueId: issue.id })).toMatchObject({ id: issue.id });
    await w.db.destroy();
  });
});

describe("issue domain — lifecycle", () => {
  it("updates core fields and deletes", async () => {
    const w = await world();
    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "Old" });
    const updated = await w.issues.updateIssue({ actorId: w.alice.id, issueId: issue.id, subject: "New" });
    expect(updated.subject).toBe("New");

    await w.issues.deleteIssue({ actorId: w.alice.id, issueId: issue.id });
    await expect(w.issues.getIssue({ actorId: w.alice.id, issueId: issue.id })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("transitions status when allowed, records history, and rejects disallowed transitions", async () => {
    const w = await worldWithWorkflow();
    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "T" });

    const moved = await w.issues.transitionIssueStatus({ actorId: w.alice.id, issueId: issue.id, toStatusId: w.doing.id });
    expect(moved.statusId).toBe(w.doing.id);

    const history = await w.issues.listIssueStatusHistory({ issueId: issue.id, pagination: { limit: 20 } });
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ fromStatusId: w.todo.id, toStatusId: w.doing.id, userId: w.alice.id });

    // todo -> todo has no transition rule, so it is rejected
    await expect(
      w.issues.transitionIssueStatus({ actorId: w.alice.id, issueId: issue.id, toStatusId: w.todo.id }),
    ).rejects.toThrow();
    await w.db.destroy();
  });

  it("lists available transitions gated by the actor's roles", async () => {
    const w = await worldWithWorkflow();
    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "T" });
    const avail = await w.issues.getAvailableTransitions({ actorId: w.alice.id, issueId: issue.id });
    expect(avail.transitions).toEqual([{ toStatusId: w.doing.id, toStatusName: "Doing" }]);
    await w.db.destroy();
  });

  it("moves an issue to another project, renumbering it", async () => {
    const w = await world();
    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "M" });
    const proj2 = await w.project.createProject({ actorId: w.admin.id, identifier: "dest", name: "Dest" });
    await w.project.addProjectMember({ actorId: w.admin.id, projectId: proj2.id, userId: w.alice.id, roleIds: [w.memberRole.id] });
    await w.issues.createIssue({ actorId: w.alice.id, projectId: proj2.id, ...w.base, subject: "existing" });

    const moved = await w.issues.moveIssue({ actorId: w.alice.id, issueId: issue.id, targetProjectId: proj2.id });
    expect(moved).toMatchObject({ projectId: proj2.id, key: "dest", number: 2 });
    await w.db.destroy();
  });
});

describe("issue domain — listIssues (search)", () => {
  it("filters by status and sorts by derived createdAt", async () => {
    const w = await world();
    const done = await w.config.createStatus({ actorId: w.admin.id, name: "Done", category: "done", sortOrder: 2 });
    const a = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "A" });
    const b = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "B" });
    await w.issues.transitionIssueStatus({ actorId: w.admin.id, issueId: b.id, toStatusId: done.id });

    const todoOnly = await w.issues.listIssues({ actorId: w.alice.id, filter: { statusIds: [w.todo.id] }, pagination: { limit: 20 } });
    expect(todoOnly.items.map((i) => i.id)).toEqual([a.id]);

    const byCreated = await w.issues.listIssues({ actorId: w.alice.id, filter: {}, sortBy: "createdAt", pagination: { limit: 20 } });
    expect(byCreated.items.map((i) => i.id)).toEqual([a.id, b.id]);
    await w.db.destroy();
  });

  it("filters by assignee (satellite EXISTS) and paginates with a keyset cursor", async () => {
    const w = await world();
    const mk = (s: string, assignee?: string) =>
      w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: s, assigneeIds: assignee ? [assignee] : [] });
    const x = await mk("X", w.alice.id);
    await mk("Y");
    const z = await mk("Z", w.alice.id);

    const mine = await w.issues.listIssues({ actorId: w.alice.id, filter: { assigneeIds: [w.alice.id] }, sortBy: "number", pagination: { limit: 1 } });
    expect(mine.items.map((i) => i.id)).toEqual([x.id]);
    expect(mine.nextCursor).toBeDefined();
    const page2 = await w.issues.listIssues({ actorId: w.alice.id, filter: { assigneeIds: [w.alice.id] }, sortBy: "number", pagination: { limit: 1, cursor: mine.nextCursor } });
    expect(page2.items.map((i) => i.id)).toEqual([z.id]);
    await w.db.destroy();
  });

  it("embeds requested satellites via include", async () => {
    const w = await world();
    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "S", assigneeIds: [w.alice.id] });
    const res = await w.issues.listIssues({ actorId: w.alice.id, filter: {}, include: ["assignees"], pagination: { limit: 20 } });
    const row = res.items.find((i) => i.id === issue.id)!;
    expect(row.assignees?.map((a) => a.id)).toEqual([w.alice.id]);
    expect(row.labels).toBeUndefined(); // not requested
    await w.db.destroy();
  });

  it("scopes results by visibility (own_or_assigned viewer sees only own/assigned)", async () => {
    const w = await world();
    const carol = await w.config.createUser({ actorId: w.admin.id, login: "carol", email: "c@x.io", displayName: "Carol" });
    await w.project.addProjectMember({ actorId: w.admin.id, projectId: w.proj.id, userId: carol.id, roleIds: [w.viewerRole.id] });
    const aliceIssue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "alice" });

    const carolView = await w.issues.listIssues({ actorId: carol.id, filter: {}, pagination: { limit: 20 } });
    expect(carolView.items.find((i) => i.id === aliceIssue.id)).toBeUndefined();
    const adminView = await w.issues.listIssues({ actorId: w.admin.id, filter: {}, pagination: { limit: 20 } });
    expect(adminView.items.find((i) => i.id === aliceIssue.id)).toBeDefined();
    await w.db.destroy();
  });

  it("lists child issues of a parent", async () => {
    const w = await world();
    const parent = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "parent" });
    const child = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "child", parentIssueId: parent.id });
    const kids = await w.issues.listChildIssues({ parentIssueId: parent.id, pagination: { limit: 20 } });
    expect(kids.items.map((i) => i.id)).toEqual([child.id]);
    await w.db.destroy();
  });
});
