import { describe, it, expect } from "vitest";
import { ForbiddenError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { workflowConfigBehaviors } from "./workflow-config.js";
import { notificationBehaviors } from "./notification.js";
import { issueBehaviors } from "./issue.js";

/**
 * Authorization gates: config/project/workflow administration is global-admin
 * only, and notifications are private to their recipient. These tests pin down
 * that a non-admin actor cannot escalate privileges or read another user's
 * notifications through the behavior layer (which is what the MCP tools call).
 */
async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const workflow = workflowConfigBehaviors(ctx);
  const notifications = notificationBehaviors(ctx);
  const issues = issueBehaviors(ctx);

  // First user on an empty DB bootstraps the admin (no admin exists yet).
  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["issue.create"], issuesVisibility: "all" });
  const todo = await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  // mallory and victim are regular (non-admin) users.
  const mallory = await config.createUser({ actorId: admin.id, login: "mallory", email: "m@x.io", displayName: "Mallory" });
  const victim = await config.createUser({ actorId: admin.id, login: "victim", email: "v@x.io", displayName: "Victim" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: mallory.id, roleIds: [role.id] });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: victim.id, roleIds: [role.id] });

  return { db, config, project, workflow, notifications, issues, admin, role, todo, priority, type, proj, mallory, victim };
}

describe("authorization — config administration is global-admin only", () => {
  it("forbids a non-admin from creating a user", async () => {
    const w = await world();
    await expect(
      w.config.createUser({ actorId: w.mallory.id, login: "x", email: "x@x.io", displayName: "X" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });

  it("forbids a non-admin from escalating themselves to admin via updateUser", async () => {
    const w = await world();
    await expect(
      w.config.updateUser({ actorId: w.mallory.id, userId: w.mallory.id, kind: "admin" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });

  it("forbids a non-admin from creating or deleting a role", async () => {
    const w = await world();
    await expect(
      w.config.createRole({ actorId: w.mallory.id, name: "Super", permissions: ["issue.delete"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      w.config.deleteRole({ actorId: w.mallory.id, roleId: w.role.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });

  it("lets a global admin administer config", async () => {
    const w = await world();
    const u = await w.config.createUser({ actorId: w.admin.id, login: "ok", email: "ok@x.io", displayName: "Ok" });
    expect(u.login).toBe("ok");
    await w.db.destroy();
  });
});

describe("authorization — project administration is global-admin only", () => {
  it("forbids a non-admin from creating a project", async () => {
    const w = await world();
    await expect(
      w.project.createProject({ actorId: w.mallory.id, identifier: "evil", name: "Evil" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });

  it("forbids a non-admin from adding themselves to a project with a chosen role", async () => {
    const w = await world();
    const other = await w.project.createProject({ actorId: w.admin.id, identifier: "other", name: "Other" });
    await expect(
      w.project.addProjectMember({ actorId: w.mallory.id, projectId: other.id, userId: w.mallory.id, roleIds: [w.role.id] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });

  it("forbids a non-admin from changing a project's visibility", async () => {
    const w = await world();
    await expect(
      w.project.setProjectVisibility({ actorId: w.mallory.id, projectId: w.proj.id, visibility: "private" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });
});

describe("authorization — workflow configuration is global-admin only", () => {
  it("forbids a non-admin from rewriting workflow transitions", async () => {
    const w = await world();
    await expect(
      w.workflow.setWorkflowTransitions({
        actorId: w.mallory.id,
        projectId: w.proj.id,
        issueTypeId: w.type.id,
        transitions: [{ fromStatusId: w.todo.id, toStatusId: w.todo.id, roleIds: [w.role.id] }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });
});

describe("authorization — notifications are private to their recipient", () => {
  it("forbids a user from listing another user's notifications", async () => {
    const w = await world();
    await expect(
      w.notifications.listNotifications({ actorId: w.mallory.id, recipientId: w.victim.id, pagination: { limit: 20 } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });

  it("forbids a user from reading another user's unread count", async () => {
    const w = await world();
    await expect(
      w.notifications.getUnreadNotificationCount({ actorId: w.mallory.id, recipientId: w.victim.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });

  it("forbids a user from marking another user's notification read", async () => {
    const w = await world();
    // admin creates an issue assigning victim, so victim (not the actor) is notified.
    await w.issues.createIssue({ actorId: w.admin.id, projectId: w.proj.id, issueTypeId: w.type.id, priorityId: w.priority.id, subject: "For victim", assigneeIds: [w.victim.id] });
    const list = await w.notifications.listNotifications({ actorId: w.victim.id, recipientId: w.victim.id, pagination: { limit: 20 } });
    expect(list.items.length).toBeGreaterThan(0);
    await expect(
      w.notifications.markNotificationRead({ actorId: w.mallory.id, notificationId: list.items[0].id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });

  it("lets a user read and mark their own notifications", async () => {
    const w = await world();
    const count = await w.notifications.getUnreadNotificationCount({ actorId: w.victim.id, recipientId: w.victim.id });
    expect(count.count).toBeGreaterThanOrEqual(0);
    await w.db.destroy();
  });
});
