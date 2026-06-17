import { describe, it, expect } from "vitest";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { workflowConfigBehaviors } from "./workflow-config.js";
import { issueBehaviors } from "./issue.js";
import { issueSatelliteBehaviors } from "./issue-satellites.js";
import { activityBehaviors } from "./activity.js";

/** Monotonic clock so occurredAt strictly increases — keeps the change-event
 *  history order deterministic regardless of wall-clock ties. */
async function world() {
  let t = Date.parse("2026-06-16T00:00:00.000Z");
  const db = await createTestDb();
  const ctx = makeCtx(db, { now: () => new Date((t += 1000)).toISOString() });
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const workflow = workflowConfigBehaviors(ctx);
  const issues = issueBehaviors(ctx);
  const sat = issueSatelliteBehaviors(ctx);
  const activity = activityBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["issue.create", "issue.update", "issue.delete"], issuesVisibility: "all" });
  const todo = await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });
  await workflow.setDefaultStatus({ actorId: admin.id, projectId: proj.id, issueTypeId: type.id, statusId: todo.id });
  const base = { issueTypeId: type.id, priorityId: priority.id };
  return { db, issues, sat, activity, admin, alice, proj, base };
}

describe("schedule / estimation change events", () => {
  it("records a schedule change with from→to and a no-op when unchanged", async () => {
    const w = await world();
    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "S", dueDate: "2026-06-10" });

    // initial event at creation: from null -> 2026-06-10
    let hist = await w.issues.listIssueScheduleHistory({ issueId: issue.id, pagination: { limit: 20 } });
    expect(hist.items).toHaveLength(1);
    expect(hist.items[0].toDueDate).toBe("2026-06-10");
    expect(hist.items[0].fromDueDate).toBeUndefined();

    await w.sat.setIssueSchedule({ actorId: w.alice.id, issueId: issue.id, dueDate: "2026-06-20" });
    await w.sat.setIssueSchedule({ actorId: w.alice.id, issueId: issue.id, dueDate: "2026-06-20" }); // no change -> no event

    hist = await w.issues.listIssueScheduleHistory({ issueId: issue.id, pagination: { limit: 20 } });
    expect(hist.items).toHaveLength(2);
    expect(hist.items[1]).toMatchObject({ fromDueDate: "2026-06-10", toDueDate: "2026-06-20" });
    await w.db.destroy();
  });

  it("records an estimation change and surfaces a marker on the activity feed", async () => {
    const w = await world();
    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "S", estimatedHours: 4 });
    await w.sat.setIssueEstimation({ actorId: w.alice.id, issueId: issue.id, estimatedHours: 6 });

    const hist = await w.issues.listIssueEstimationHistory({ issueId: issue.id, pagination: { limit: 20 } });
    expect(hist.items.map((e) => e.toHours)).toEqual([4, 6]);
    expect(hist.items[1]).toMatchObject({ fromHours: 4, toHours: 6 });

    const feed = await w.activity.listActivities({ targetId: issue.id, action: "estimated", pagination: { limit: 20 } });
    expect(feed.items).toHaveLength(2);
    await w.db.destroy();
  });

  it("computes due-date slippage from the schedule history", async () => {
    const w = await world();
    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "S", dueDate: "2026-06-10" });
    await w.sat.setIssueSchedule({ actorId: w.alice.id, issueId: issue.id, dueDate: "2026-06-25" });

    const hist = await w.issues.listIssueScheduleHistory({ issueId: issue.id, pagination: { limit: 50 } });
    const committed = hist.items[0].toDueDate!;
    const current = hist.items[hist.items.length - 1].toDueDate!;
    const slipDays = (Date.parse(current) - Date.parse(committed)) / 86_400_000;
    expect(slipDays).toBe(15);
    await w.db.destroy();
  });
});

describe("issue deletion preserves events (immutable data model)", () => {
  it("removes the resource but keeps status/schedule/activity events and records a deleted event", async () => {
    const w = await world();
    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "S", dueDate: "2026-06-10" });
    await w.sat.setIssueSchedule({ actorId: w.alice.id, issueId: issue.id, dueDate: "2026-06-20" });

    await w.issues.deleteIssue({ actorId: w.alice.id, issueId: issue.id });

    // the resource is gone
    await expect(w.issues.getIssue({ actorId: w.alice.id, issueId: issue.id })).rejects.toThrow();

    // but its events survive
    const schedule = await w.issues.listIssueScheduleHistory({ issueId: issue.id, pagination: { limit: 20 } });
    expect(schedule.items.length).toBeGreaterThan(0);

    const feed = await w.activity.listActivities({ targetId: issue.id, pagination: { limit: 50 } });
    const actions = feed.items.map((e) => e.action);
    expect(actions).toContain("created");
    expect(actions).toContain("deleted");
    await w.db.destroy();
  });
});
