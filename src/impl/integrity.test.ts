import { describe, expect, it } from "vitest";
import { sql } from "kysely";
import { createTestDb } from "./test-db.js";
import { createSqlBehaviors } from "./index.js";
import { ensureBootstrapped } from "./bootstrap.js";
import { ConflictError, NotFoundError, ValidationError } from "./errors.js";

const page = { pagination: { limit: 50 } };

async function world() {
  const db = await createTestDb();
  const b = createSqlBehaviors(db);
  const s = (await ensureBootstrapped(b))!;
  const actorId = s.adminId;
  const other = await b.createProject({ actorId, identifier: "other", name: "Other", visibility: "private" });
  const role = (await b.listRoles({ actorId, ...page })).items[0]!;
  await b.addProjectMember({ actorId, projectId: other.id, userId: s.memberId, roleIds: [role.id] });
  const base = { actorId: s.memberId, projectId: s.projectId, issueTypeId: s.issueTypeId, priorityId: s.priorityId, subject: "S" };
  const otherLabel = await b.createLabel({ actorId, projectId: other.id, name: "secret", color: "#000000" });
  const otherMilestone = await b.createMilestone({ actorId, projectId: other.id, name: "m" });
  const otherCategory = await b.createCategory({ actorId, projectId: other.id, name: "c" });
  const otherIteration = await b.createIteration({ actorId, projectId: other.id, name: "i" , startDate: "2026-01-01", endDate: "2026-01-14" });
  const otherIssue = await b.createIssue({ ...base, projectId: other.id, statusId: s.statusIds.todo });
  const issue = await b.createIssue(base);
  return { db, b, s, actorId, other, role, base, otherLabel, otherMilestone, otherCategory, otherIteration, otherIssue, issue };
}

describe("the schema", () => {
  /** Columns that name a row but are not a foreign key, and why. */
  const NOT_KEYS: Record<string, string> = {
    "issue_status_changes.issue_id": "Event", "issue_schedule_changes.issue_id": "Event", "issue_estimation_changes.issue_id": "Event",
    "comments.issue_id": "Event", "time_entries.issue_id": "Event", "draft_conversions.draft_id": "Event", "draft_conversions.issue_id": "Event",
    "activity_entries.project_id": "Event", "notifications.project_id": "Event",
    "activity_entries.target_id": "any type", "attachments.target_id": "any type", "notifications.target_id": "any type",
    "time_entries.activity_id": "free text", "user_credentials.key_id": "its own name",
  };
  it("declares every reference, so none is left to be remembered", async () => {
    const db = await createTestDb();
    const tables = (await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name not like 'sqlite%' and name not like 'kysely%'`.execute(db)).rows;
    const open: string[] = [];
    for (const { name } of tables) {
      const keys = new Set((await sql<{ from: string }>`select "from" from pragma_foreign_key_list(${name})`.execute(db)).rows.map((r) => r.from));
      for (const c of (await sql<{ name: string }>`select name from pragma_table_info(${name})`.execute(db)).rows) {
        if (c.name.endsWith("_id") && !keys.has(c.name)) open.push(`${name}.${c.name}`);
      }
    }
    expect(open.sort()).toEqual(Object.keys(NOT_KEYS).sort());
  });

  it("is enforced on every connection", async () => {
    const db = await createTestDb();
    expect((await sql<{ foreign_keys: number }>`pragma foreign_keys`.execute(db)).rows[0]!.foreign_keys).toBe(1);
  });
});

describe("writing a reference to something that does not exist", () => {
  it("is refused everywhere, naming the candidates and no table or column", async () => {
    const { b, s, actorId, base, issue, role, other } = await world();
    const no = "nope";
    const writes: Record<string, () => Promise<unknown>> = {
      "issue status": () => b.createIssue({ ...base, statusId: no }),
      "issue priority": () => b.createIssue({ ...base, priorityId: no }),
      "issue type": () => b.createIssue({ ...base, issueTypeId: no, statusId: s.statusIds.todo }),
      "issue label": () => b.createIssue({ ...base, labelIds: [no] }),
      "issue milestone": () => b.createIssue({ ...base, milestoneId: no }),
      "updated priority": () => b.updateIssue({ actorId, issueId: issue.id, priorityId: no }),
      "updated type": () => b.updateIssue({ actorId, issueId: issue.id, issueTypeId: no }),
      "transition": () => b.transitionIssueStatus({ actorId, issueId: issue.id, toStatusId: no }),
      "moved type": () => b.moveIssue({ actorId, issueId: issue.id, targetProjectId: other.id, newIssueTypeId: no }),
      "labels": () => b.setIssueLabels({ actorId, issueId: issue.id, labelIds: [no] }),
      "category": () => b.setIssueCategory({ actorId, issueId: issue.id, categoryId: no }),
      "milestone": () => b.setIssueMilestone({ actorId, issueId: issue.id, milestoneId: no }),
      "iteration": () => b.setIssueIteration({ actorId, issueId: issue.id, iterationId: no }),
      "member": () => b.addProjectMember({ actorId, projectId: s.projectId, userId: no, roleIds: [role.id] }),
      "member role": () => b.updateProjectMember({ actorId, projectId: s.projectId, userId: s.memberId, roleIds: [no] }),
      "workflow status": () => b.setWorkflowTransitions({ actorId, projectId: s.projectId, issueTypeId: s.issueTypeId, transitions: [{ fromStatusId: no, toStatusId: s.statusIds.done, roleIds: [] }] }),
      "workflow role": () => b.setWorkflowTransitions({ actorId, projectId: s.projectId, issueTypeId: s.issueTypeId, transitions: [{ fromStatusId: s.statusIds.todo, toStatusId: s.statusIds.done, roleIds: [no] }] }),
      "default status": () => b.setDefaultStatus({ actorId, projectId: s.projectId, issueTypeId: s.issueTypeId, statusId: no }),
      "label project": () => b.createLabel({ actorId, projectId: no, name: "x", color: "#000000" }),
      "project parent": () => b.setProjectParent({ actorId, childProjectId: s.projectId, parentProjectId: no }),
      "new project's parent": () => b.createProject({ actorId, identifier: "x", name: "X", parentProjectId: no }),
      "template priority": () => b.createIssueTemplate({ actorId, projectId: s.projectId, name: "T", descriptionTemplate: "", defaultPriorityId: no }),
      "time by": () => b.createTimeEntry({ actorId, projectId: s.projectId, userId: no, activityId: "dev", hours: 1, spentOn: "2026-01-01" }),
      "group member": () => b.addGroupMember({ actorId, groupId: no, userId: s.memberId }),
      "user state": () => b.setUserStatus({ actorId, userId: no, status: "active" }),
    };
    for (const [name, write] of Object.entries(writes)) {
      const err = await write().then(() => undefined, (e: Error) => e);
      expect(err, name).toBeInstanceOf(ValidationError);
      expect(err!.message, name).not.toMatch(/constraint|FOREIGN|_id\b/i);
    }
    // an issue that isn't there looks like one the actor can't see
    await expect(b.createTimeEntry({ actorId, projectId: s.projectId, userId: s.memberId, issueId: no, activityId: "dev", hours: 1, spentOn: "2026-01-01" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(b.createIssue({ ...base, priorityId: no })).rejects.toThrow(/priorityId/);
    // and none of it was kept
    expect((await b.listIssues({ actorId, filter: { projectId: s.projectId }, ...page })).items).toHaveLength(1);
  });
});

describe("what belongs to a project", () => {
  it("can't be attached to another project's issue, and is not told apart from nothing", async () => {
    const w = await world();
    const { b, actorId, base, issue } = w;
    const at = { actorId, issueId: issue.id };
    for (const write of [
      () => b.createIssue({ ...base, labelIds: [w.otherLabel.id] }), () => b.createIssue({ ...base, milestoneId: w.otherMilestone.id }), () => b.createIssue({ ...base, categoryId: w.otherCategory.id }),
      () => b.setIssueLabels({ ...at, labelIds: [w.otherLabel.id] }), () => b.setIssueCategory({ ...at, categoryId: w.otherCategory.id }),
      () => b.setIssueMilestone({ ...at, milestoneId: w.otherMilestone.id }), () => b.setIssueIteration({ ...at, iterationId: w.otherIteration.id }),
      () => b.createTimeEntry({ actorId, projectId: w.s.projectId, userId: w.s.memberId, issueId: w.otherIssue.id, activityId: "dev", hours: 1, spentOn: "2026-01-01" }),
    ]) await expect(write()).rejects.toBeInstanceOf(ValidationError);
    const message = (id: string) => b.setIssueLabels({ ...at, labelIds: [id] }).catch((e: Error) => e.message.replace(id, "?"));
    expect(await message(w.otherLabel.id)).toBe(await message("nope"));
  });

  it("stays behind when an issue moves, with assignees who are not members there", async () => {
    const w = await world();
    const { b, actorId, s } = w;
    const label = await b.createLabel({ actorId, projectId: s.projectId, name: "l", color: "#000000" });
    const milestone = await b.createMilestone({ actorId, projectId: s.projectId, name: "m" });
    const local = await b.createUser({ actorId, login: "local", email: "l@x.io", displayName: "L" });
    await b.addProjectMember({ actorId, projectId: s.projectId, userId: local.id, roleIds: [w.role.id] });
    const i = await b.createIssue({ ...w.base, labelIds: [label.id], milestoneId: milestone.id, assigneeIds: [s.memberId, local.id] });
    await b.moveIssue({ actorId, issueId: i.id, targetProjectId: w.other.id });
    const d = await b.getIssueDetail({ actorId, issueId: i.id });
    expect([d.labels, d.milestone, d.assignees.map((a) => a.id)]).toEqual([[], undefined, [s.memberId]]);
  });

  it("does not let a new issue hang under one its author can't see", async () => {
    const w = await world();
    const out = await w.b.createUser({ actorId: w.actorId, login: "out", email: "o@x.io", displayName: "O" });
    await w.b.addProjectMember({ actorId: w.actorId, projectId: w.s.projectId, userId: out.id, roleIds: [w.role.id] });
    await expect(w.b.createIssue({ ...w.base, actorId: out.id, parentIssueId: w.otherIssue.id })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("placing something under itself", () => {
  it("is refused at any depth, for issues and projects", async () => {
    const { b, actorId, base, s, other } = await world();
    const [x, y, z] = [await b.createIssue(base), await b.createIssue(base), await b.createIssue(base)];
    const under = (childIssueId: string, parentIssueId: string) => b.setIssueParent({ actorId, childIssueId, parentIssueId });
    await under(y.id, x.id);
    await under(z.id, y.id);
    for (const p of [x, y, z]) await expect(under(x.id, p.id)).rejects.toBeInstanceOf(ValidationError);
    expect((await b.getIssueDetail({ actorId, issueId: y.id })).parent!.id).toBe(x.id);
    await b.setProjectParent({ actorId, childProjectId: other.id, parentProjectId: s.projectId });
    await expect(b.setProjectParent({ actorId, childProjectId: s.projectId, parentProjectId: other.id })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("deleting what is in use", () => {
  it("is refused for what an issue, its history or the workflow is made of", async () => {
    const { b, actorId, s, role, issue } = await world();
    const type = await b.createIssueType({ actorId, name: "Other" });
    const prio = await b.createPriority({ actorId, name: "Other" });
    for (const [name, del] of Object.entries({
      priority: () => b.deletePriority({ actorId, priorityId: s.priorityId }), type: () => b.deleteIssueType({ actorId, issueTypeId: s.issueTypeId }),
      status: () => b.deleteStatus({ actorId, statusId: s.statusIds.todo }), role: () => b.deleteRole({ actorId, roleId: role.id }),
      author: () => b.deleteUser({ actorId, userId: s.memberId }), project: () => b.deleteProject({ actorId, projectId: s.projectId }),
    })) await expect(del(), name).rejects.toBeInstanceOf(ConflictError);
    await b.deletePriority({ actorId, priorityId: prio.id });
    await b.deleteIssueType({ actorId, issueTypeId: type.id });
    await expect(b.deletePriority({ actorId, priorityId: prio.id })).rejects.toBeInstanceOf(NotFoundError);
    expect(await b.getIssue({ actorId, issueId: issue.id })).toMatchObject({ priorityId: s.priorityId });
  });

  it("is refused for a role only a workflow names", async () => {
    const { b, actorId, s } = await world();
    const r = await b.createRole({ actorId, name: "Reviewer", permissions: [], issuesVisibility: "all" });
    const set = (roleIds: string[]) => b.setWorkflowTransitions({ actorId, projectId: s.projectId, issueTypeId: s.issueTypeId, transitions: [{ fromStatusId: s.statusIds.todo, toStatusId: s.statusIds.done, roleIds }] });
    await set([r.id]);
    await expect(b.deleteRole({ actorId, roleId: r.id })).rejects.toBeInstanceOf(ConflictError);
    await set([]);
    await b.deleteRole({ actorId, roleId: r.id });
  });

  it("takes a tag off the issues that had it", async () => {
    const { b, actorId, s, base } = await world();
    const label = await b.createLabel({ actorId, projectId: s.projectId, name: "l", color: "#000000" });
    const category = await b.createCategory({ actorId, projectId: s.projectId, name: "c" });
    const milestone = await b.createMilestone({ actorId, projectId: s.projectId, name: "m" });
    const i = await b.createIssue({ ...base, labelIds: [label.id], categoryId: category.id, milestoneId: milestone.id });
    await b.deleteLabel({ actorId, labelId: label.id });
    await b.deleteCategory({ actorId, categoryId: category.id });
    await b.deleteMilestone({ actorId, milestoneId: milestone.id });
    const d = await b.getIssueDetail({ actorId, issueId: i.id });
    expect([d.labels, d.category, d.milestone]).toEqual([[], undefined, undefined]);
  });

  it("removes an empty project with its configuration and leaves nothing pointing at it", async () => {
    const { db, b, actorId, other, otherIssue, s } = await world();
    const out = await b.createUser({ actorId, login: "out", email: "o@x.io", displayName: "O" });
    await expect(b.deleteProject({ actorId, projectId: other.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(b.getIssue({ actorId: out.id, issueId: otherIssue.id })).rejects.toBeInstanceOf(NotFoundError);
    const draft = await b.createDraftIssue({ actorId, projectId: other.id, title: "idea" });
    await b.deleteIssue({ actorId, issueId: otherIssue.id });
    await expect(b.deleteProject({ actorId, projectId: other.id })).rejects.toBeInstanceOf(ConflictError);
    await b.deleteDraftIssue({ actorId, draftId: draft.id });
    await b.deleteProject({ actorId, projectId: other.id });
    for (const t of ["labels", "categories", "milestones", "iterations", "project_memberships", "project_categories"] as const) {
      expect(await db.selectFrom(t).select("id").where("project_id", "=", other.id).execute(), t).toEqual([]);
    }
    // its past is for an admin only
    for (const who of [out.id, s.memberId]) await expect(b.listIssueStatusHistory({ actorId: who, issueId: otherIssue.id, ...page })).rejects.toBeInstanceOf(NotFoundError);
    expect((await b.listIssueStatusHistory({ actorId, issueId: otherIssue.id, ...page })).items).toHaveLength(1);
  });

  it("removes an unused user with their keys and memberships", async () => {
    const { db, b, actorId, s, role } = await world();
    const u = await b.createUser({ actorId, login: "u", email: "u@x.io", displayName: "U" });
    await b.addProjectMember({ actorId, projectId: s.projectId, userId: u.id, roleIds: [role.id] });
    await b.issueUserKey({ actorId, userId: u.id });
    await b.deleteUser({ actorId, userId: u.id });
    expect(await db.selectFrom("user_credentials").selectAll().where("user_id", "=", u.id).execute()).toEqual([]);
  });
});

describe("the last active admin", () => {
  it("can't be deleted, demoted or deactivated", async () => {
    const { b, actorId } = await world();
    const loss = (userId: string) => [
      () => b.deleteUser({ actorId, userId }), () => b.updateUser({ actorId, userId, kind: "regular" }), () => b.setUserStatus({ actorId, userId, status: "inactive" }),
    ];
    for (const f of loss(actorId)) await expect(f()).rejects.toBeInstanceOf(ConflictError);
    await b.updateUser({ actorId, userId: actorId, displayName: "Still admin" });
    const second = await b.createUser({ actorId, login: "second", email: "s@x.io", displayName: "S", kind: "admin" });
    await b.setUserStatus({ actorId, userId: second.id, status: "inactive" });
    for (const f of loss(actorId)) await expect(f()).rejects.toBeInstanceOf(ConflictError); // an inactive one doesn't count
    await b.setUserStatus({ actorId, userId: second.id, status: "active" });
    await b.updateUser({ actorId, userId: actorId, kind: "regular" });
  });
});
