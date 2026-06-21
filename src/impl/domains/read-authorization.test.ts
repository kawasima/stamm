import { describe, it, expect } from "vitest";
import { NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { userExtraBehaviors } from "./user-extras.js";
import { projectBehaviors } from "./project.js";
import { issueBehaviors } from "./issue.js";
import { commentBehaviors } from "./comment.js";
import { attachmentBehaviors } from "./attachment.js";
import { issueSatelliteBehaviors } from "./issue-satellites.js";
import { milestoneBehaviors } from "./milestone.js";
import { iterationBehaviors } from "./iteration.js";
import { draftBehaviors } from "./draft.js";
import { viewBehaviors } from "./view.js";
import { timeEntryBehaviors } from "./time-entry.js";

/**
 * Read scoping for everything that hangs off an issue. A non-member must not be
 * able to read comments, attachments, history, watchers, relations, or child
 * issues of an issue in a private project just by holding its id — the same
 * NotFound policy `getIssue` already enforces must cover the satellites too.
 */
async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const issues = issueBehaviors(ctx);
  const comments = commentBehaviors(ctx);
  const attachments = attachmentBehaviors(ctx);
  const sat = issueSatelliteBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["issue.create", "comment.create", "attachment.create", "issue.update", "issue.assign"], issuesVisibility: "all" });
  await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });

  const proj = await project.createProject({ actorId: admin.id, identifier: "secret", name: "Secret" });
  await project.setProjectVisibility({ actorId: admin.id, projectId: proj.id, visibility: "private" });

  const member = await config.createUser({ actorId: admin.id, login: "member", email: "mem@x.io", displayName: "Member" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: member.id, roleIds: [role.id] });
  const outsider = await config.createUser({ actorId: admin.id, login: "outsider", email: "out@x.io", displayName: "Outsider" });

  const issue = await issues.createIssue({ actorId: admin.id, projectId: proj.id, issueTypeId: type.id, priorityId: priority.id, subject: "Secret issue" });
  const comment = await comments.createComment({ actorId: admin.id, issueId: issue.id, body: "secret note" });
  const attachment = await attachments.createAttachment({ actorId: admin.id, targetType: "issue", targetId: issue.id, filename: "secret.pdf", contentType: "application/pdf", sizeBytes: 10, storageKey: "k1" });

  return { db, config, project, issues, comments, attachments, sat, admin, member, outsider, proj, issue, comment, attachment };
}

describe("read authorization — issue satellites are hidden from non-members of a private project", () => {
  it("forbids an outsider from listing comments", async () => {
    const w = await world();
    await expect(
      w.comments.listComments({ actorId: w.outsider.id, issueId: w.issue.id, pagination: { limit: 20 } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids an outsider from getting a comment", async () => {
    const w = await world();
    await expect(
      w.comments.getComment({ actorId: w.outsider.id, commentId: w.comment.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids an outsider from listing attachments", async () => {
    const w = await world();
    await expect(
      w.attachments.listAttachments({ actorId: w.outsider.id, targetType: "issue", targetId: w.issue.id, pagination: { limit: 20 } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids an outsider from getting an attachment", async () => {
    const w = await world();
    await expect(
      w.attachments.getAttachment({ actorId: w.outsider.id, attachmentId: w.attachment.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids an outsider from reading issue status/schedule/estimation history", async () => {
    const w = await world();
    await expect(w.issues.listIssueStatusHistory({ actorId: w.outsider.id, issueId: w.issue.id, pagination: { limit: 20 } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.issues.listIssueScheduleHistory({ actorId: w.outsider.id, issueId: w.issue.id, pagination: { limit: 20 } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.issues.listIssueEstimationHistory({ actorId: w.outsider.id, issueId: w.issue.id, pagination: { limit: 20 } })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids an outsider from listing child issues of a private parent", async () => {
    const w = await world();
    await expect(
      w.issues.listChildIssues({ actorId: w.outsider.id, parentIssueId: w.issue.id, pagination: { limit: 20 } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids an outsider from listing watchers and relations", async () => {
    const w = await world();
    await expect(w.sat.listIssueWatchers({ actorId: w.outsider.id, issueId: w.issue.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.sat.listIssueRelations({ actorId: w.outsider.id, issueId: w.issue.id, pagination: { limit: 20 } })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("lets a member read the same satellites", async () => {
    const w = await world();
    const list = await w.comments.listComments({ actorId: w.member.id, issueId: w.issue.id, pagination: { limit: 20 } });
    expect(list.items.length).toBe(1);
    const att = await w.attachments.listAttachments({ actorId: w.member.id, targetType: "issue", targetId: w.issue.id, pagination: { limit: 20 } });
    expect(att.items.length).toBe(1);
    const watchers = await w.sat.listIssueWatchers({ actorId: w.member.id, issueId: w.issue.id });
    expect(Array.isArray(watchers.watchers)).toBe(true);
    await w.db.destroy();
  });
});

async function projectWorld() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const milestones = milestoneBehaviors(ctx);
  const iterations = iterationBehaviors(ctx);
  const drafts = draftBehaviors(ctx);
  const views = viewBehaviors(ctx);
  const time = timeEntryBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["milestone.manage", "iteration.manage", "issue.create", "view.manage"], issuesVisibility: "all" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "secret", name: "Secret" });
  await project.setProjectVisibility({ actorId: admin.id, projectId: proj.id, visibility: "private" });
  const member = await config.createUser({ actorId: admin.id, login: "member", email: "mem@x.io", displayName: "Member" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: member.id, roleIds: [role.id] });
  const outsider = await config.createUser({ actorId: admin.id, login: "outsider", email: "out@x.io", displayName: "Outsider" });

  const milestone = await milestones.createMilestone({ actorId: admin.id, projectId: proj.id, name: "M1" });
  const iteration = await iterations.createIteration({ actorId: admin.id, projectId: proj.id, name: "Sprint 1", startDate: "2026-06-01", endDate: "2026-06-14" });
  const draft = await drafts.createDraftIssue({ actorId: admin.id, projectId: proj.id, title: "secret draft" });
  const view = await views.createProjectView({ actorId: admin.id, projectId: proj.id, name: "V", layout: "board", ownerId: admin.id, visibility: "private", filter: {} });

  return { db, config, project, milestones, iterations, drafts, views, time, admin, member, outsider, proj, milestone, iteration, draft, view };
}

describe("read authorization — project-scoped resources are hidden from non-members of a private project", () => {
  it("forbids an outsider from reading milestones", async () => {
    const w = await projectWorld();
    await expect(w.milestones.getMilestone({ actorId: w.outsider.id, milestoneId: w.milestone.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.milestones.listMilestones({ actorId: w.outsider.id, projectId: w.proj.id, pagination: { limit: 20 } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.milestones.getMilestoneProgress({ actorId: w.outsider.id, milestoneId: w.milestone.id })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids an outsider from reading iterations", async () => {
    const w = await projectWorld();
    await expect(w.iterations.getIteration({ actorId: w.outsider.id, iterationId: w.iteration.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.iterations.listIterations({ actorId: w.outsider.id, projectId: w.proj.id, pagination: { limit: 20 } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.iterations.getIterationProgress({ actorId: w.outsider.id, iterationId: w.iteration.id })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids an outsider from reading drafts", async () => {
    const w = await projectWorld();
    await expect(w.drafts.getDraftIssue({ actorId: w.outsider.id, draftId: w.draft.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.drafts.listDraftIssues({ actorId: w.outsider.id, projectId: w.proj.id, pagination: { limit: 20 } })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids an outsider from reading time entries and summaries of a private project", async () => {
    const w = await projectWorld();
    await expect(w.time.listTimeEntries({ actorId: w.outsider.id, projectId: w.proj.id, pagination: { limit: 20 } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.time.getTimeSummary({ actorId: w.outsider.id, projectId: w.proj.id, groupBy: "user" })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("forbids an outsider from reading the project, its members, and its views", async () => {
    const w = await projectWorld();
    await expect(w.project.getProject({ actorId: w.outsider.id, projectId: w.proj.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.project.listProjectMembers({ actorId: w.outsider.id, projectId: w.proj.id, pagination: { limit: 20 } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.views.getProjectView({ actorId: w.outsider.id, viewId: w.view.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.views.listBoardPositions({ actorId: w.outsider.id, viewId: w.view.id })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("omits a private project from an outsider's project listing", async () => {
    const w = await projectWorld();
    const list = await w.project.listProjects({ actorId: w.outsider.id, pagination: { limit: 50 } });
    expect(list.items.map((p) => p.id)).not.toContain(w.proj.id);
    await w.db.destroy();
  });

  it("lets a member read project-scoped resources", async () => {
    const w = await projectWorld();
    expect((await w.milestones.listMilestones({ actorId: w.member.id, projectId: w.proj.id, pagination: { limit: 20 } })).items.length).toBe(1);
    expect((await w.drafts.listDraftIssues({ actorId: w.member.id, projectId: w.proj.id, pagination: { limit: 20 } })).items.length).toBe(1);
    expect((await w.project.listProjects({ actorId: w.member.id, pagination: { limit: 50 } })).items.map((p) => p.id)).toContain(w.proj.id);
    await w.db.destroy();
  });
});

async function userDirectoryWorld() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const extras = userExtraBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "admin@x.io", displayName: "Admin", kind: "admin" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "alice@x.io", displayName: "Alice" });
  const bob = await config.createUser({ actorId: admin.id, login: "bob", email: "bob@x.io", displayName: "Bob" });
  const group = await config.createUserGroup({ actorId: admin.id, name: "Team" });
  await extras.addGroupMember({ actorId: admin.id, groupId: group.id, userId: alice.id });
  await extras.addGroupMember({ actorId: admin.id, groupId: group.id, userId: bob.id });

  return { db, config, extras, admin, alice, bob, group };
}

describe("read authorization — the user directory does not leak email/admin PII to non-admins", () => {
  it("omits email when a non-admin reads another user, but keeps login/displayName/kind", async () => {
    const w = await userDirectoryWorld();
    const seen = await w.config.getUser({ actorId: w.alice.id, userId: w.bob.id });
    expect(seen.email).toBeUndefined();
    expect(seen.login).toBe("bob");
    expect(seen.displayName).toBe("Bob");
    expect(seen.kind).toBe("regular");
    await w.db.destroy();
  });

  it("returns email to a global admin", async () => {
    const w = await userDirectoryWorld();
    const seen = await w.config.getUser({ actorId: w.admin.id, userId: w.bob.id });
    expect(seen.email).toBe("bob@x.io");
    await w.db.destroy();
  });

  it("lets a user read their own email", async () => {
    const w = await userDirectoryWorld();
    const seen = await w.config.getUser({ actorId: w.alice.id, userId: w.alice.id });
    expect(seen.email).toBe("alice@x.io");
    await w.db.destroy();
  });

  it("strips other users' email from a non-admin's listing but keeps the viewer's own", async () => {
    const w = await userDirectoryWorld();
    const list = await w.config.listUsers({ actorId: w.alice.id, pagination: { limit: 50 } });
    expect(list.items.find((u) => u.login === "bob")?.email).toBeUndefined();
    expect(list.items.find((u) => u.login === "admin")?.email).toBeUndefined();
    expect(list.items.find((u) => u.login === "alice")?.email).toBe("alice@x.io");
    await w.db.destroy();
  });

  it("keeps email in a global admin's user listing", async () => {
    const w = await userDirectoryWorld();
    const list = await w.config.listUsers({ actorId: w.admin.id, pagination: { limit: 50 } });
    expect(list.items.find((u) => u.login === "bob")?.email).toBe("bob@x.io");
    await w.db.destroy();
  });

  it("strips email when no viewer identifies itself (least privilege)", async () => {
    const w = await userDirectoryWorld();
    const list = await w.config.listUsers({ pagination: { limit: 50 } });
    expect(list.items.every((u) => u.email === undefined)).toBe(true);
    await w.db.destroy();
  });

  it("omits email from group member listings for a non-admin but keeps it for an admin", async () => {
    const w = await userDirectoryWorld();
    const asMember = await w.extras.listGroupMembers({ actorId: w.alice.id, groupId: w.group.id, pagination: { limit: 50 } });
    expect(asMember.items.length).toBe(2);
    expect(asMember.items.find((u) => u.login === "bob")?.email).toBeUndefined();
    const asAdmin = await w.extras.listGroupMembers({ actorId: w.admin.id, groupId: w.group.id, pagination: { limit: 50 } });
    expect(asAdmin.items.some((u) => u.email === "bob@x.io")).toBe(true);
    await w.db.destroy();
  });
});
