import { describe, it, expect } from "vitest";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { issueBehaviors } from "./issue.js";
import { issueSatelliteBehaviors } from "./issue-satellites.js";

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const issues = issueBehaviors(ctx);
  const sat = issueSatelliteBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["issue.create", "issue.update", "issue.assign"], issuesVisibility: "all" });
  await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });
  const issue = await issues.createIssue({ actorId: alice.id, projectId: proj.id, issueTypeId: type.id, priorityId: priority.id, subject: "I" });
  return { db, config, project, issues, sat, admin, role, priority, type, proj, alice, issue };
}

describe("issue satellites", () => {
  it("setIssueAssignees replaces all and getIssueDetail reflects it", async () => {
    const w = await world();
    await w.sat.setIssueAssignees({ actorId: w.alice.id, issueId: w.issue.id, assigneeIds: [w.alice.id, w.admin.id] });
    const r2 = await w.sat.setIssueAssignees({ actorId: w.alice.id, issueId: w.issue.id, assigneeIds: [w.admin.id] });
    expect(r2.assignees.map((a) => a.assigneeId)).toEqual([w.admin.id]);
    const detail = await w.issues.getIssueDetail({ actorId: w.alice.id, issueId: w.issue.id });
    expect(detail.assignees.map((a) => a.assigneeId)).toEqual([w.admin.id]);
    await w.db.destroy();
  });

  it("upserts 0..1 satellites (milestone replaced on re-set)", async () => {
    const w = await world();
    await w.sat.setIssueMilestone({ actorId: w.alice.id, issueId: w.issue.id, milestoneId: "m1" });
    const r = await w.sat.setIssueMilestone({ actorId: w.alice.id, issueId: w.issue.id, milestoneId: "m2" });
    expect(r.milestoneId).toBe("m2");
    const detail = await w.issues.getIssueDetail({ actorId: w.alice.id, issueId: w.issue.id });
    expect(detail.milestone?.milestoneId).toBe("m2");
    await w.db.destroy();
  });

  it("watch is idempotent and unwatch removes", async () => {
    const w = await world();
    const a = await w.sat.watchIssue({ actorId: w.alice.id, issueId: w.issue.id });
    const b = await w.sat.watchIssue({ actorId: w.alice.id, issueId: w.issue.id });
    expect(b.id).toBe(a.id); // idempotent
    expect((await w.sat.listIssueWatchers({ issueId: w.issue.id })).watchers).toHaveLength(1);
    await w.sat.unwatchIssue({ actorId: w.alice.id, issueId: w.issue.id });
    expect((await w.sat.listIssueWatchers({ issueId: w.issue.id })).watchers).toHaveLength(0);
    await w.db.destroy();
  });

  it("creates, lists, and deletes relations", async () => {
    const w = await world();
    const other = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, issueTypeId: w.type.id, priorityId: w.priority.id, subject: "Other" });
    const rel = await w.sat.createIssueRelation({ actorId: w.alice.id, issueId: w.issue.id, relatedIssueId: other.id, relationType: "blocks" });
    expect((await w.sat.listIssueRelations({ issueId: w.issue.id, pagination: { limit: 20 } })).items).toHaveLength(1);
    await w.sat.deleteIssueRelation({ actorId: w.alice.id, relationId: rel.id });
    expect((await w.sat.listIssueRelations({ issueId: w.issue.id, pagination: { limit: 20 } })).items).toHaveLength(0);
    await expect(w.sat.deleteIssueRelation({ actorId: w.alice.id, relationId: rel.id })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("gates setIssueAssignees on the issue.assign permission", async () => {
    const w = await world();
    const noPerm = await w.config.createRole({ actorId: w.admin.id, name: "NoAssign", permissions: ["issue.update"], issuesVisibility: "all" });
    const bob = await w.config.createUser({ actorId: w.admin.id, login: "bob", email: "b@x.io", displayName: "Bob" });
    await w.project.addProjectMember({ actorId: w.admin.id, projectId: w.proj.id, userId: bob.id, roleIds: [noPerm.id] });
    await expect(w.sat.setIssueAssignees({ actorId: bob.id, issueId: w.issue.id, assigneeIds: [bob.id] })).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });
});
