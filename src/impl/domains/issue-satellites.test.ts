import { describe, it, expect } from "vitest";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { issueBehaviors } from "./issue.js";
import { issueSatelliteBehaviors } from "./issue-satellites.js";
import { milestoneBehaviors } from "./milestone.js";

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const issues = issueBehaviors(ctx);
  const sat = issueSatelliteBehaviors(ctx);
  const milestones = milestoneBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["issue.create", "issue.update", "issue.assign"], issuesVisibility: "all" });
  await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });
  const issue = await issues.createIssue({ actorId: alice.id, projectId: proj.id, issueTypeId: type.id, priorityId: priority.id, subject: "I" });
  return { db, config, project, issues, sat, milestones, admin, role, priority, type, proj, alice, issue };
}

describe("issue satellites", () => {
  it("setIssueAssignees replaces all and getIssueDetail reflects it", async () => {
    const w = await world();
    await w.sat.setIssueAssignees({ actorId: w.alice.id, issueId: w.issue.id, assigneeIds: [w.alice.id, w.admin.id] });
    const r2 = await w.sat.setIssueAssignees({ actorId: w.alice.id, issueId: w.issue.id, assigneeIds: [w.admin.id] });
    expect(r2.assignees.map((a) => a.assigneeId)).toEqual([w.admin.id]);
    const detail = await w.issues.getIssueDetail({ actorId: w.alice.id, issueId: w.issue.id });
    expect(detail.assignees.map((a) => a.id)).toEqual([w.admin.id]);
    await w.db.destroy();
  });

  it("upserts 0..1 satellites (milestone replaced on re-set)", async () => {
    const w = await world();
    const m1 = await w.milestones.createMilestone({ actorId: w.admin.id, projectId: w.proj.id, name: "m1" });
    const m2 = await w.milestones.createMilestone({ actorId: w.admin.id, projectId: w.proj.id, name: "m2" });
    await w.sat.setIssueMilestone({ actorId: w.alice.id, issueId: w.issue.id, milestoneId: m1.id });
    const r = await w.sat.setIssueMilestone({ actorId: w.alice.id, issueId: w.issue.id, milestoneId: m2.id });
    expect(r.milestoneId).toBe(m2.id);
    const detail = await w.issues.getIssueDetail({ actorId: w.alice.id, issueId: w.issue.id });
    expect(detail.milestone?.id).toBe(m2.id);
    await w.db.destroy();
  });

  it("watch is idempotent and unwatch removes", async () => {
    const w = await world();
    const a = await w.sat.watchIssue({ actorId: w.alice.id, issueId: w.issue.id });
    const b = await w.sat.watchIssue({ actorId: w.alice.id, issueId: w.issue.id });
    expect(b.id).toBe(a.id); // idempotent
    expect((await w.sat.listIssueWatchers({ actorId: w.alice.id, issueId: w.issue.id })).watchers).toHaveLength(1);
    await w.sat.unwatchIssue({ actorId: w.alice.id, issueId: w.issue.id });
    expect((await w.sat.listIssueWatchers({ actorId: w.alice.id, issueId: w.issue.id })).watchers).toHaveLength(0);
    await w.db.destroy();
  });

  it("creates, lists, and deletes relations", async () => {
    const w = await world();
    const other = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.proj.id, issueTypeId: w.type.id, priorityId: w.priority.id, subject: "Other" });
    const rel = await w.sat.createIssueRelation({ actorId: w.alice.id, issueId: w.issue.id, relatedIssueId: other.id, relationType: "blocks" });
    expect((await w.sat.listIssueRelations({ actorId: w.alice.id, issueId: w.issue.id, pagination: { limit: 20 } })).items).toHaveLength(1);
    await w.sat.deleteIssueRelation({ actorId: w.alice.id, relationId: rel.id });
    expect((await w.sat.listIssueRelations({ actorId: w.alice.id, issueId: w.issue.id, pagination: { limit: 20 } })).items).toHaveLength(0);
    await expect(w.sat.deleteIssueRelation({ actorId: w.alice.id, relationId: rel.id })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("getIssueDetail hydrates satellites into their target resources", async () => {
    const w = await world();
    const label = await w.config.createLabel({ actorId: w.admin.id, projectId: w.proj.id, name: "bug", color: "#ff0000" });
    const ms = await w.milestones.createMilestone({ actorId: w.admin.id, projectId: w.proj.id, name: "v1" });
    await w.sat.setIssueLabels({ actorId: w.alice.id, issueId: w.issue.id, labelIds: [label.id] });
    await w.sat.setIssueMilestone({ actorId: w.alice.id, issueId: w.issue.id, milestoneId: ms.id });
    await w.sat.setIssueAssignees({ actorId: w.alice.id, issueId: w.issue.id, assigneeIds: [w.alice.id] });

    const detail = await w.issues.getIssueDetail({ actorId: w.alice.id, issueId: w.issue.id });
    // labels carry the Label resource (name + color), not the junction row
    expect(detail.labels).toEqual([expect.objectContaining({ id: label.id, name: "bug", color: "#ff0000" })]);
    // milestone carries the Milestone resource (name), not just milestoneId
    expect(detail.milestone).toEqual(expect.objectContaining({ id: ms.id, name: "v1" }));
    // assignees carry the User resource (displayName), not just assigneeId
    expect(detail.assignees).toEqual([expect.objectContaining({ id: w.alice.id, displayName: "Alice" })]);
    await w.db.destroy();
  });

  it("listIssues include hydrates satellites into their target resources", async () => {
    const w = await world();
    const label = await w.config.createLabel({ actorId: w.admin.id, projectId: w.proj.id, name: "bug", color: "#ff0000" });
    const ms = await w.milestones.createMilestone({ actorId: w.admin.id, projectId: w.proj.id, name: "v1" });
    await w.sat.setIssueLabels({ actorId: w.alice.id, issueId: w.issue.id, labelIds: [label.id] });
    await w.sat.setIssueMilestone({ actorId: w.alice.id, issueId: w.issue.id, milestoneId: ms.id });
    await w.sat.setIssueAssignees({ actorId: w.alice.id, issueId: w.issue.id, assigneeIds: [w.alice.id] });

    const res = await w.issues.listIssues({ actorId: w.alice.id, filter: {}, include: ["labels", "milestone", "assignees"], pagination: { limit: 20 } });
    const row = res.items.find((i) => i.id === w.issue.id)!;
    expect(row.labels).toEqual([expect.objectContaining({ id: label.id, name: "bug", color: "#ff0000" })]);
    expect(row.milestone).toEqual(expect.objectContaining({ id: ms.id, name: "v1" }));
    expect(row.assignees).toEqual([expect.objectContaining({ id: w.alice.id, displayName: "Alice" })]);
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
