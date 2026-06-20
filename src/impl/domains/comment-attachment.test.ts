import { describe, it, expect } from "vitest";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { issueBehaviors } from "./issue.js";
import { commentBehaviors } from "./comment.js";
import { attachmentBehaviors } from "./attachment.js";

function steppingClock(): () => string {
  let t = Date.parse("2026-01-01T00:00:00.000Z");
  return () => { const s = new Date(t).toISOString(); t += 1000; return s; };
}

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db, { now: steppingClock() });
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const issues = issueBehaviors(ctx);
  const comments = commentBehaviors(ctx);
  const attachments = attachmentBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["issue.create", "comment.create", "comment.update", "comment.delete", "attachment.create", "attachment.delete"], issuesVisibility: "all" });
  await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });
  const issue = await issues.createIssue({ actorId: alice.id, projectId: proj.id, issueTypeId: type.id, priorityId: priority.id, subject: "I" });
  return { db, config, project, comments, attachments, admin, proj, alice, issue };
}

describe("comments", () => {
  it("creates, updates, lists (chronological), and deletes", async () => {
    const w = await world();
    const c1 = await w.comments.createComment({ issueId: w.issue.id, actorId: w.alice.id, body: "first" });
    await w.comments.createComment({ issueId: w.issue.id, actorId: w.alice.id, body: "second" });
    const list = await w.comments.listComments({ actorId: w.alice.id, issueId: w.issue.id, pagination: { limit: 20 } });
    expect(list.items.map((c) => c.body)).toEqual(["first", "second"]);

    const updated = await w.comments.updateComment({ actorId: w.alice.id, commentId: c1.id, body: "edited" });
    expect(updated.body).toBe("edited");
    expect((await w.comments.getComment({ actorId: w.alice.id, commentId: c1.id })).body).toBe("edited");

    await w.comments.deleteComment({ actorId: w.alice.id, commentId: c1.id });
    await expect(w.comments.getComment({ actorId: w.alice.id, commentId: c1.id })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("requires comment.create permission", async () => {
    const w = await world();
    const bob = await w.config.createUser({ actorId: w.admin.id, login: "bob", email: "b@x.io", displayName: "Bob" });
    const noPerm = await w.config.createRole({ actorId: w.admin.id, name: "NoComment", permissions: [], issuesVisibility: "all" });
    await w.project.addProjectMember({ actorId: w.admin.id, projectId: w.proj.id, userId: bob.id, roleIds: [noPerm.id] });
    await expect(w.comments.createComment({ issueId: w.issue.id, actorId: bob.id, body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });
});

describe("attachments (metadata only)", () => {
  it("creates, gets, lists by target, and deletes", async () => {
    const w = await world();
    const a = await w.attachments.createAttachment({
      targetType: "issue", targetId: w.issue.id, actorId: w.alice.id,
      filename: "spec.pdf", contentType: "application/pdf", sizeBytes: 1024, storageKey: "s3://bucket/spec.pdf",
    });
    expect(a).toMatchObject({ filename: "spec.pdf", targetId: w.issue.id, authorId: w.alice.id });
    expect((await w.attachments.getAttachment({ actorId: w.alice.id, attachmentId: a.id })).storageKey).toBe("s3://bucket/spec.pdf");

    const list = await w.attachments.listAttachments({ actorId: w.alice.id, targetType: "issue", targetId: w.issue.id, pagination: { limit: 20 } });
    expect(list.items).toHaveLength(1);

    await w.attachments.deleteAttachment({ actorId: w.alice.id, attachmentId: a.id });
    await expect(w.attachments.getAttachment({ actorId: w.alice.id, attachmentId: a.id })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });
});
