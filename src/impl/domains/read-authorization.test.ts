import { describe, it, expect } from "vitest";
import { NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { issueBehaviors } from "./issue.js";
import { commentBehaviors } from "./comment.js";
import { attachmentBehaviors } from "./attachment.js";
import { issueSatelliteBehaviors } from "./issue-satellites.js";

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
