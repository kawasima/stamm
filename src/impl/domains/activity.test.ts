import { describe, it, expect } from "vitest";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { issueBehaviors } from "./issue.js";
import { workflowConfigBehaviors } from "./workflow-config.js";
import { activityBehaviors } from "./activity.js";

/** Monotonic clock so occurredAt is strictly increasing — makes "newest first"
 *  ordering and keyset pagination deterministic regardless of wall-clock ties. */
function world() {
  return (async () => {
    let t = Date.parse("2026-06-16T00:00:00.000Z");
    const db = await createTestDb();
    const ctx = makeCtx(db, { now: () => new Date((t += 1000)).toISOString() });
    const config = configBehaviors(ctx);
    const project = projectBehaviors(ctx);
    const issues = issueBehaviors(ctx);
    const workflow = workflowConfigBehaviors(ctx);
    const activity = activityBehaviors(ctx);

    const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
    const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["issue.create", "issue.update"], issuesVisibility: "all" });
    const todo = await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
    const done = await config.createStatus({ actorId: admin.id, name: "Done", category: "done", sortOrder: 1 });
    const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
    const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
    const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
    const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
    await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });
    await workflow.setDefaultStatus({ actorId: admin.id, projectId: proj.id, issueTypeId: type.id, statusId: todo.id });
    await workflow.setWorkflowTransitions({ actorId: admin.id, projectId: proj.id, issueTypeId: type.id, transitions: [{ fromStatusId: todo.id, toStatusId: done.id, roleIds: [role.id] }] });

    // alice creates an issue and transitions it: timeline gets created + status_changed.
    const base = { issueTypeId: type.id, priorityId: priority.id };
    const issue = await issues.createIssue({ actorId: alice.id, projectId: proj.id, ...base, subject: "Bug" });
    await issues.transitionIssueStatus({ actorId: alice.id, issueId: issue.id, toStatusId: done.id });

    return { db, activity, admin, alice, proj, issue };
  })();
}

describe("activity feed (read-only over the canonical timeline)", () => {
  it("lists project activity newest-first", async () => {
    const w = await world();
    const { items } = await w.activity.listActivities({ projectId: w.proj.id, pagination: { limit: 50 } });

    expect(items.length).toBeGreaterThan(0);
    expect(items.every((e) => e.projectId === w.proj.id)).toBe(true);
    const occurred = items.map((e) => e.occurredAt);
    expect([...occurred].sort().reverse()).toEqual(occurred); // strictly newest-first
    await w.db.destroy();
  });

  it("filters by target, action, and actor", async () => {
    const w = await world();

    const byTarget = await w.activity.listActivities({ targetId: w.issue.id, pagination: { limit: 50 } });
    expect(byTarget.items.every((e) => e.targetId === w.issue.id)).toBe(true);
    expect(byTarget.items.map((e) => e.action).sort()).toEqual(["created", "status_changed"]);

    const created = await w.activity.listActivities({ action: "created", pagination: { limit: 50 } });
    expect(created.items.length).toBeGreaterThan(0);
    expect(created.items.every((e) => e.action === "created")).toBe(true);

    const byActor = await w.activity.listActivities({ userId: w.alice.id, pagination: { limit: 50 } });
    expect(byActor.items.length).toBeGreaterThan(0);
    expect(byActor.items.every((e) => e.userId === w.alice.id)).toBe(true);
    await w.db.destroy();
  });

  it("paginates with a keyset cursor without gaps or repeats", async () => {
    const w = await world();
    const all = await w.activity.listActivities({ projectId: w.proj.id, pagination: { limit: 50 } });

    const walked: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await w.activity.listActivities({ projectId: w.proj.id, pagination: { limit: 1, cursor } });
      walked.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(walked).toEqual(all.items.map((e) => e.id)); // same order, every entry once
    await w.db.destroy();
  });

  it("gets one entry by id and rejects an unknown id", async () => {
    const w = await world();
    const { items } = await w.activity.listActivities({ targetId: w.issue.id, pagination: { limit: 1 } });
    const got = await w.activity.getActivity({ activityId: items[0].id });
    expect(got).toMatchObject({ id: items[0].id, targetId: w.issue.id });

    await expect(w.activity.getActivity({ activityId: "does-not-exist" })).rejects.toThrow();
    await w.db.destroy();
  });
});
