import { describe, it, expect } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { createSqlBehaviors } from "../index.js";
import { connect } from "../../mcp/test-helpers.js";
import type { KeyScope } from "../../schema/index.js";

/**
 * Key scopes narrow a user's own rights. The same db is wrapped in behaviors
 * built with and without a scope, which is exactly what the HTTP layer does
 * after authenticating a scoped key.
 */
async function world() {
  const db = await createTestDb();
  const full = createSqlBehaviors(db);
  const as = (scope: KeyScope) => createSqlBehaviors(db, { scope });

  const admin = await full.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await full.createRole({
    actorId: admin.id, name: "Dev", issuesVisibility: "all",
    permissions: ["issue.create", "issue.update", "issue.delete", "comment.create", "time_entry.create"],
  });
  const todo = await full.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await full.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await full.createIssueType({ actorId: admin.id, name: "Bug" });
  const a = await full.createProject({ actorId: admin.id, identifier: "aaa", name: "A" });
  const b = await full.createProject({ actorId: admin.id, identifier: "bbb", name: "B" });
  const alice = await full.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  for (const p of [a, b]) await full.addProjectMember({ actorId: admin.id, projectId: p.id, userId: alice.id, roleIds: [role.id] });

  const base = { issueTypeId: type.id, priorityId: priority.id };
  const issueA = await full.createIssue({ actorId: alice.id, projectId: a.id, ...base, subject: "In A" });
  const issueB = await full.createIssue({ actorId: alice.id, projectId: b.id, ...base, subject: "In B" });
  await full.setIssueParent({ actorId: alice.id, childIssueId: issueA.id, parentIssueId: issueB.id });
  await full.createIssueRelation({ actorId: alice.id, issueId: issueA.id, relatedIssueId: issueB.id, relationType: "relates_to" });

  for (const [project, issue] of [[a, issueA], [b, issueB]] as const) {
    await full.createTimeEntry({ actorId: alice.id, projectId: project.id, issueId: issue.id, userId: alice.id, activityId: "dev", hours: 1, spentOn: "2026-06-01" });
  }

  return { db, full, as, admin, alice, a, b, issueA, issueB, base, todo };
}

describe("key scope — issuing", () => {
  it("stores the scope and shows it in the key listing", async () => {
    const w = await world();
    const issued = await w.full.issueUserKey({ actorId: w.admin.id, userId: w.alice.id, scope: { readOnly: true, projectIds: [w.a.id] } });
    expect(issued.scope).toEqual({ readOnly: true, projectIds: [w.a.id] });
    const listed = await w.full.listUserKeys({ actorId: w.admin.id, userId: w.alice.id });
    expect(listed.items.find((k) => k.keyId === issued.keyId)?.scope).toEqual({ readOnly: true, projectIds: [w.a.id] });
    // no scope given = unrestricted
    expect((await w.full.issueUserKey({ actorId: w.admin.id, userId: w.alice.id })).scope).toEqual({});
    await w.db.destroy();
  });

  it("rejects a scope that names a project that does not exist", async () => {
    const w = await world();
    await expect(
      w.full.issueUserKey({ actorId: w.admin.id, userId: w.alice.id, scope: { projectIds: ["nope"] } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await w.db.destroy();
  });
});

describe("key scope — project-limited", () => {
  it("reads and writes inside its project, and sees nothing of the others", async () => {
    const w = await world();
    const k = w.as({ projectIds: [w.a.id] });

    expect((await k.getIssue({ actorId: w.alice.id, issueId: w.issueA.id })).id).toBe(w.issueA.id);
    await expect(k.getIssue({ actorId: w.alice.id, issueId: w.issueB.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(k.getProject({ actorId: w.alice.id, projectId: w.b.id })).rejects.toBeInstanceOf(NotFoundError);
    expect(await k.getProjectByIdentifier({ actorId: w.alice.id, identifier: "bbb" })).toBeNull();
    await expect(
      k.createIssue({ actorId: w.alice.id, projectId: w.b.id, ...w.base, subject: "nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(k.createIssue({ actorId: w.alice.id, projectId: w.a.id, ...w.base, subject: "ok" })).resolves.toBeTruthy();
    await w.db.destroy();
  });

  it("lists only its own projects' issues, projects, activity and time entries", async () => {
    const w = await world();
    const k = w.as({ projectIds: [w.a.id] });
    const page = { limit: 100 };

    const issues = await k.listIssues({ actorId: w.alice.id, filter: {}, pagination: page });
    expect(issues.items.map((i) => i.id)).toEqual([w.issueA.id]);
    const projects = await k.listProjects({ actorId: w.alice.id, pagination: page });
    expect(projects.items.map((p) => p.id)).toEqual([w.a.id]);
    const feed = await k.listActivities({ actorId: w.alice.id, pagination: page });
    expect(feed.items.length).toBeGreaterThan(0);
    expect(feed.items.every((e) => e.projectId === w.a.id)).toBe(true);
    const time = await k.listTimeEntries({ actorId: w.alice.id, pagination: page });
    expect(time.items).toHaveLength(1);
    expect(time.items[0].projectId).toBe(w.a.id);
    await w.db.destroy();
  });

  it("does not leak a parent, child or relation that lives in another project", async () => {
    const w = await world();
    const k = w.as({ projectIds: [w.a.id] });
    const detail = await k.getIssueDetail({ actorId: w.alice.id, issueId: w.issueA.id });
    expect(detail.parent).toBeUndefined();
    expect(detail.relations).toEqual([]);
    expect((await k.listIssueRelations({ actorId: w.alice.id, issueId: w.issueA.id, pagination: { limit: 20 } })).items).toEqual([]);
    // the same issue as seen from B's side: B is the parent of A, which is out of scope here
    const kb = w.as({ projectIds: [w.b.id] });
    expect((await kb.listChildIssues({ actorId: w.alice.id, parentIssueId: w.issueB.id, pagination: { limit: 20 } })).items).toEqual([]);
    // unscoped key still sees them
    const full = await w.full.getIssueDetail({ actorId: w.alice.id, issueId: w.issueA.id });
    expect(full.parent?.id).toBe(w.issueB.id);
    expect(full.relations).toHaveLength(1);
    await w.db.destroy();
  });

  it("never acts as a global admin, even for an admin's key", async () => {
    const w = await world();
    const k = w.as({ projectIds: [w.a.id] });
    // admin is not a member of A or B, so only the admin bypass could reach them
    await expect(k.getIssue({ actorId: w.admin.id, issueId: w.issueB.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(k.createProject({ actorId: w.admin.id, identifier: "ccc", name: "C" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(k.issueUserKey({ actorId: w.admin.id, userId: w.alice.id })).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });
});

describe("key scope — read-only", () => {
  it("reads everything the user can, and writes nothing, not even as an admin", async () => {
    const w = await world();
    const k = w.as({ readOnly: true });

    // an admin key still reads across projects
    expect((await k.getIssue({ actorId: w.admin.id, issueId: w.issueB.id })).id).toBe(w.issueB.id);
    expect((await k.listProjects({ actorId: w.admin.id, pagination: { limit: 10 } })).items).toHaveLength(2);

    await expect(k.createIssue({ actorId: w.alice.id, projectId: w.a.id, ...w.base, subject: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(k.updateIssue({ actorId: w.alice.id, issueId: w.issueA.id, subject: "y" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(k.createProject({ actorId: w.admin.id, identifier: "ccc", name: "C" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(k.issueUserKey({ actorId: w.admin.id, userId: w.alice.id })).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });
});

describe("key scope — MCP tool surface", () => {
  const names = async (b: ReturnType<typeof createSqlBehaviors>, actorId: string, scope?: KeyScope) => {
    const client = await connect(b, { actorId, ...(scope ? { scope } : {}) } as never);
    return new Set((await client.listTools()).tools.map((t) => t.name));
  };

  it("hides every write tool from a read-only key", async () => {
    const w = await world();
    const scope = { readOnly: true };
    const tools = await names(w.as(scope), w.alice.id, scope);
    expect(tools.has("issue_get")).toBe(true);
    expect(tools.has("admin_get")).toBe(true);
    for (const t of ["issue_create", "issue_update", "issue_transition", "comment_add", "admin_create", "admin_update", "admin_delete", "user_key_issue", "notification_read"]) {
      expect(tools.has(t), t).toBe(false);
    }
    await w.db.destroy();
  });

  it("offers a project-limited key only the audited tools", async () => {
    const w = await world();
    const scope = { projectIds: [w.a.id] };
    const tools = await names(w.as(scope), w.alice.id, scope);
    for (const t of ["issue_get", "issue_search", "issue_update", "comment_add", "activity_list", "notification_list", "notification_read", "admin_get", "admin_list", "workflow_list", "template_list"]) expect(tools.has(t), t).toBe(true);
    for (const t of ["admin_create", "admin_update", "admin_delete", "user_key_issue", "user_key_list", "issue_move", "attachment_list", "template_create", "project_create"]) {
      expect(tools.has(t), t).toBe(false);
    }
    // an unscoped connection still sees them all
    expect((await names(w.full, w.alice.id)).has("admin_create")).toBe(true);
    await w.db.destroy();
  });

  it("refuses to call a tool the scope hides", async () => {
    const w = await world();
    const scope = { readOnly: true };
    const client = await connect(w.as(scope), { actorId: w.alice.id, scope } as never);
    const res = await client.callTool({ name: "issue_create", arguments: { projectId: w.a.id, issueTypeId: w.base.issueTypeId, priorityId: w.base.priorityId, subject: "x" } });
    expect(res.isError).toBe(true);
    await w.db.destroy();
  });
});

describe("key scope — notifications and mentions", () => {
  async function withMentions() {
    const w = await world();
    const bob = await w.full.createUser({ actorId: w.admin.id, login: "bob", email: "b@x.io", displayName: "Bob" });
    const roles = await w.full.listRoles({ actorId: w.admin.id, pagination: { limit: 10 } });
    for (const p of [w.a, w.b]) await w.full.addProjectMember({ actorId: w.admin.id, projectId: p.id, userId: bob.id, roleIds: [roles.items[0]!.id] });
    await w.full.createComment({ issueId: w.issueA.id, actorId: bob.id, body: "@alice in A" });
    await w.full.createComment({ issueId: w.issueB.id, actorId: bob.id, body: "@alice in B" });
    return { ...w, bob };
  }

  it("a project-limited key reads only its own projects' notifications and can count and mark them", async () => {
    const w = await withMentions();
    const scoped = w.as({ projectIds: [w.a.id] });
    const list = await scoped.listNotifications({ actorId: w.alice.id, recipientId: w.alice.id, isRead: false, eventType: "issue.mentioned", pagination: { limit: 50 } });
    expect(list.items.map((n) => n.projectId)).toEqual([w.a.id]);
    expect((await scoped.getUnreadNotificationCount({ actorId: w.alice.id, recipientId: w.alice.id })).count).toBe(
      (await scoped.listNotifications({ actorId: w.alice.id, recipientId: w.alice.id, pagination: { limit: 50 } })).items.length,
    );
    await scoped.markNotificationRead({ actorId: w.alice.id, notificationId: list.items[0]!.id });
    // The unscoped view still has the other project's mention unread.
    const rest = await w.full.listNotifications({ actorId: w.alice.id, recipientId: w.alice.id, isRead: false, eventType: "issue.mentioned", pagination: { limit: 50 } });
    expect(rest.items.map((n) => n.projectId)).toEqual([w.b.id]);
    await w.db.destroy();
  });

  it("a project-limited key cannot mark another project's notification read, and mark-all leaves it alone", async () => {
    const w = await withMentions();
    const scoped = w.as({ projectIds: [w.a.id] });
    const other = (await w.full.listNotifications({ actorId: w.alice.id, recipientId: w.alice.id, eventType: "issue.mentioned", pagination: { limit: 50 } })).items.find((n) => n.projectId === w.b.id)!;
    await expect(scoped.markNotificationRead({ actorId: w.alice.id, notificationId: other.id })).rejects.toBeInstanceOf(NotFoundError);
    await scoped.markAllNotificationsRead({ actorId: w.alice.id, recipientId: w.alice.id });
    const still = await w.full.listNotifications({ actorId: w.alice.id, recipientId: w.alice.id, isRead: false, pagination: { limit: 50 } });
    expect(still.items.some((n) => n.id === other.id)).toBe(true);
    await w.db.destroy();
  });
});
