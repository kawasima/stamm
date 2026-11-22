import { describe, it, expect } from "vitest";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { issueBehaviors } from "./issue.js";
import { issueSatelliteBehaviors } from "./issue-satellites.js";

/**
 * Write-side gaps around cross-resource links. A write may only touch a private
 * issue/project the actor can reach: you cannot watch an issue you can't see,
 * move an issue into a project you have no rights in, or link your issue to a
 * private issue in another project.
 */
async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const issues = issueBehaviors(ctx);
  const sat = issueSatelliteBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["issue.create", "issue.update", "issue.move"], issuesVisibility: "all" });
  await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });

  // Project A: alice is a member. Project B: private, alice is NOT a member.
  const projA = await project.createProject({ actorId: admin.id, identifier: "aaa", name: "A" });
  const projB = await project.createProject({ actorId: admin.id, identifier: "bbb", name: "B" });
  await project.setProjectVisibility({ actorId: admin.id, projectId: projB.id, visibility: "private" });

  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  await project.addProjectMember({ actorId: admin.id, projectId: projA.id, userId: alice.id, roleIds: [role.id] });

  const aliceIssue = await issues.createIssue({ actorId: alice.id, projectId: projA.id, issueTypeId: type.id, priorityId: priority.id, subject: "Alice's" });
  const secretIssue = await issues.createIssue({ actorId: admin.id, projectId: projB.id, issueTypeId: type.id, priorityId: priority.id, subject: "Secret" });

  return { db, config, project, issues, sat, admin, alice, projA, projB, type, priority, aliceIssue, secretIssue };
}

describe("write authorization — cross-resource writes respect the target's access", () => {
  it("forbids watching an issue the actor cannot see", async () => {
    const w = await world();
    await expect(
      w.sat.watchIssue({ actorId: w.alice.id, issueId: w.secretIssue.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // no watcher row leaked in
    const watchers = await w.sat.listIssueWatchers({ actorId: w.admin.id, issueId: w.secretIssue.id });
    expect(watchers.watchers.map((x) => x.userId)).not.toContain(w.alice.id);
    await w.db.destroy();
  });

  it("forbids moving an issue into a project the actor has no rights in", async () => {
    const w = await world();
    await expect(
      w.issues.moveIssue({ actorId: w.alice.id, issueId: w.aliceIssue.id, targetProjectId: w.projB.id }),
    ).rejects.toBeInstanceOf(NotFoundError); // a project they can't see is not there
    await w.db.destroy();
  });

  it("forbids linking a parent issue the actor cannot see", async () => {
    const w = await world();
    await expect(
      w.sat.setIssueParent({ actorId: w.alice.id, childIssueId: w.aliceIssue.id, parentIssueId: w.secretIssue.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids relating to an issue the actor cannot see", async () => {
    const w = await world();
    await expect(
      w.sat.createIssueRelation({ actorId: w.alice.id, issueId: w.aliceIssue.id, relatedIssueId: w.secretIssue.id, relationType: "blocks" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids a non-member from transitioning an issue even when the rule allows any member", async () => {
    const w = await world();
    const doing = await w.config.createStatus({ actorId: w.admin.id, name: "Doing", category: "in_progress", sortOrder: 1 });
    const todo = (await w.db.selectFrom("statuses").select("id").where("name", "=", "Todo").executeTakeFirstOrThrow()).id;
    const wf = (await import("./workflow-config.js")).workflowConfigBehaviors(makeCtx(w.db));
    // empty roleIds = "any member"
    for (const projectId of [w.projA.id, w.projB.id]) {
      await wf.setWorkflowTransitions({ actorId: w.admin.id, projectId, issueTypeId: w.type.id, transitions: [{ fromStatusId: todo, toStatusId: doing.id, roleIds: [] }] });
    }
    const outsider = await w.config.createUser({ actorId: w.admin.id, login: "eve", email: "e@x.io", displayName: "Eve" });

    // public project: visible but not a member -> Forbidden
    await expect(
      w.issues.transitionIssueStatus({ actorId: outsider.id, issueId: w.aliceIssue.id, toStatusId: doing.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // private project: existence hidden -> NotFound
    await expect(
      w.issues.transitionIssueStatus({ actorId: outsider.id, issueId: w.secretIssue.id, toStatusId: doing.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // a member is still allowed
    const moved = await w.issues.transitionIssueStatus({ actorId: w.alice.id, issueId: w.aliceIssue.id, toStatusId: doing.id });
    expect(moved.statusId).toBe(doing.id);
    await w.db.destroy();
  });

  it("still allows a member to watch and link within their own project", async () => {
    const w = await world();
    const other = await w.issues.createIssue({ actorId: w.alice.id, projectId: w.projA.id, issueTypeId: w.type.id, priorityId: w.priority.id, subject: "Other" });
    const watch = await w.sat.watchIssue({ actorId: w.alice.id, issueId: w.aliceIssue.id });
    expect(watch.userId).toBe(w.alice.id);
    const rel = await w.sat.createIssueRelation({ actorId: w.alice.id, issueId: w.aliceIssue.id, relatedIssueId: other.id, relationType: "relates_to" });
    expect(rel.relatedIssueId).toBe(other.id);
    await w.db.destroy();
  });
});
