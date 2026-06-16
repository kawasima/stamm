import { describe, it, expect } from "vitest";
import { NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { issueBehaviors } from "./issue.js";
import { issueSatelliteBehaviors } from "./issue-satellites.js";
import { milestoneBehaviors } from "./milestone.js";
import { iterationBehaviors } from "./iteration.js";

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const issues = issueBehaviors(ctx);
  const sat = issueSatelliteBehaviors(ctx);
  const milestones = milestoneBehaviors(ctx);
  const iterations = iterationBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Lead", permissions: ["issue.create", "issue.update", "milestone.manage", "iteration.manage"], issuesVisibility: "all" });
  const todo = await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const done = await config.createStatus({ actorId: admin.id, name: "Done", category: "done", sortOrder: 1 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });
  const base = { issueTypeId: type.id, priorityId: priority.id };
  return { db, config, project, issues, sat, milestones, iterations, admin, todo, done, priority, type, proj, alice, base };
}

describe("milestones", () => {
  it("create, lifecycle (close/reopen/lock), list filtered by status, delete", async () => {
    const w = await world();
    const m = await w.milestones.createMilestone({ actorId: w.alice.id, projectId: w.proj.id, name: "v1" });
    expect(m.status).toBe("open");
    expect((await w.milestones.closeMilestone({ actorId: w.alice.id, milestoneId: m.id, releaseDate: "2026-09-01" })).status).toBe("closed");
    expect((await w.milestones.reopenMilestone({ actorId: w.alice.id, milestoneId: m.id })).status).toBe("open");
    expect((await w.milestones.lockMilestone({ actorId: w.alice.id, milestoneId: m.id })).status).toBe("locked");

    const locked = await w.milestones.listMilestones({ projectId: w.proj.id, status: "locked", pagination: { limit: 20 } });
    expect(locked.items.map((x) => x.id)).toEqual([m.id]);

    await w.milestones.deleteMilestone({ actorId: w.alice.id, milestoneId: m.id });
    await expect(w.milestones.getMilestone({ milestoneId: m.id })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("computes progress from linked issues' status categories", async () => {
    const w = await world();
    const m = await w.milestones.createMilestone({ actorId: w.alice.id, projectId: w.proj.id, name: "v1" });
    const i1 = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "a", milestoneId: m.id });
    await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "b", milestoneId: m.id });
    await w.issues.transitionIssueStatus({ actorId: w.admin.id, issueId: i1.id, toStatusId: w.done.id });

    const p = await w.milestones.getMilestoneProgress({ milestoneId: m.id });
    expect(p).toMatchObject({ totalIssues: 2, closedIssues: 1, openIssues: 1, completionPercentage: 50 });

    const empty = await w.milestones.getMilestoneProgress({ milestoneId: (await w.milestones.createMilestone({ actorId: w.alice.id, projectId: w.proj.id, name: "v2" })).id });
    expect(empty).toMatchObject({ totalIssues: 0, completionPercentage: 0 });
    await w.db.destroy();
  });
});

describe("iterations", () => {
  it("create, update, list, delete, and progress", async () => {
    const w = await world();
    const it = await w.iterations.createIteration({ actorId: w.alice.id, projectId: w.proj.id, name: "Sprint 1", startDate: "2026-01-01", endDate: "2026-01-14" });
    expect(it.name).toBe("Sprint 1");
    expect((await w.iterations.updateIteration({ actorId: w.alice.id, iterationId: it.id, name: "Sprint 1b" })).name).toBe("Sprint 1b");

    const issue = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, ...w.base, subject: "x" });
    await w.sat.setIssueIteration({ actorId: w.alice.id, issueId: issue.id, iterationId: it.id });
    await w.issues.transitionIssueStatus({ actorId: w.admin.id, issueId: issue.id, toStatusId: w.done.id });
    const p = await w.iterations.getIterationProgress({ iterationId: it.id });
    expect(p).toMatchObject({ totalIssues: 1, closedIssues: 1, completionPercentage: 100 });

    const list = await w.iterations.listIterations({ projectId: w.proj.id, pagination: { limit: 20 } });
    expect(list.items).toHaveLength(1);
    await w.iterations.deleteIteration({ actorId: w.alice.id, iterationId: it.id });
    await expect(w.iterations.getIteration({ iterationId: it.id })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });
});
