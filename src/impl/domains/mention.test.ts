import { describe, it, expect } from "vitest";
import { ConflictError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { issueBehaviors } from "./issue.js";
import { commentBehaviors } from "./comment.js";
import { notificationBehaviors } from "./notification.js";

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const issues = issueBehaviors(ctx);
  const comments = commentBehaviors(ctx);
  const notifications = notificationBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["issue.create", "comment.create", "comment.update"], issuesVisibility: "all" });
  const ownRole = await config.createRole({ actorId: admin.id, name: "Own", permissions: ["comment.create"], issuesVisibility: "own_or_assigned" });
  await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const mk = async (login: string, roleId?: string) => {
    const u = await config.createUser({ actorId: admin.id, login, email: `${login}@x.io`, displayName: login });
    if (roleId) await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: u.id, roleIds: [roleId] });
    return u;
  };
  const alice = await mk("alice", role.id);
  const bob = await mk("bob", role.id);
  const carol = await mk("Carol", role.id);
  const outsider = await mk("outsider");
  const limited = await mk("limited", ownRole.id);
  const issue = await issues.createIssue({ actorId: alice.id, projectId: proj.id, issueTypeId: type.id, priorityId: priority.id, subject: "Bug" });
  const inbox = async (u: { id: string }) =>
    (await notifications.listNotifications({ actorId: u.id, recipientId: u.id, pagination: { limit: 50 } })).items;
  return { db, config, comments, notifications, issue, alice, bob, carol, outsider, limited, admin, proj, inbox };
}

describe("@login mentions in comments", () => {
  it("notifies a mentioned member with one mention pointing at the comment, not also a 'commented'", async () => {
    const w = await world();
    const c = await w.comments.createComment({ issueId: w.issue.id, actorId: w.alice.id, body: "@bob can you take a look?" });
    const items = await w.inbox(w.bob);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ eventType: "issue.mentioned", targetType: "comment", targetId: c.id, projectId: w.proj.id });
    expect(items[0]!.title).toContain(`${w.issue.key}-${w.issue.number}`);
  });

  it("matches logins case-insensitively and never notifies the author", async () => {
    const w = await world();
    await w.comments.createComment({ issueId: w.issue.id, actorId: w.bob.id, body: "ping @CAROL, and myself @bob" });
    expect((await w.inbox(w.carol)).map((n) => n.eventType)).toEqual(["issue.mentioned"]);
    expect(await w.inbox(w.bob)).toHaveLength(0);
  });

  it("treats a non-member, an unknown login and a user who cannot read the issue as plain text", async () => {
    const w = await world();
    await w.comments.createComment({ issueId: w.issue.id, actorId: w.alice.id, body: "@outsider @ghost @limited hello" });
    expect(await w.inbox(w.outsider)).toHaveLength(0);
    // `limited` may only see own/assigned issues, and this one is neither.
    expect(await w.inbox(w.limited)).toHaveLength(0);
  });

  it("keeps the generic notification for the audience that was not mentioned", async () => {
    const w = await world();
    // alice authored the issue; bob comments and mentions carol only.
    await w.comments.createComment({ issueId: w.issue.id, actorId: w.bob.id, body: "@carol fyi" });
    expect((await w.inbox(w.alice)).map((n) => n.eventType)).toContain("issue.commented");
    expect((await w.inbox(w.carol)).map((n) => n.eventType)).toEqual(["issue.mentioned"]);
  });

  it("does not make the author of the issue get both when they are mentioned", async () => {
    const w = await world();
    await w.comments.createComment({ issueId: w.issue.id, actorId: w.bob.id, body: "@alice done" });
    const types = (await w.inbox(w.alice)).map((n) => n.eventType).filter((t) => t !== "issue.created");
    expect(types).toEqual(["issue.mentioned"]);
  });

  it("on edit notifies only newly added mentions", async () => {
    const w = await world();
    const c = await w.comments.createComment({ issueId: w.issue.id, actorId: w.alice.id, body: "@bob look" });
    await w.comments.updateComment({ actorId: w.alice.id, commentId: c.id, body: "@bob look (typo fixed)" });
    expect(await w.inbox(w.bob)).toHaveLength(1);
    await w.comments.updateComment({ actorId: w.alice.id, commentId: c.id, body: "@bob @carol look" });
    expect(await w.inbox(w.bob)).toHaveLength(1);
    expect(await w.inbox(w.carol)).toHaveLength(1);
  });
});

describe("login uniqueness", () => {
  it("rejects a second user whose login differs only by case", async () => {
    const w = await world();
    await expect(
      w.config.createUser({ actorId: w.admin.id, login: "BOB", email: "other@x.io", displayName: "Other" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
