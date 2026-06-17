import { describe, it, expect } from "vitest";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { workflowConfigBehaviors } from "./workflow-config.js";
import { draftBehaviors } from "./draft.js";

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const workflow = workflowConfigBehaviors(ctx);
  const drafts = draftBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["issue.create", "issue.update", "issue.delete"], issuesVisibility: "all" });
  const todo = await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  const bob = await config.createUser({ actorId: admin.id, login: "bob", email: "b@x.io", displayName: "Bob" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });
  await workflow.setDefaultStatus({ actorId: admin.id, projectId: proj.id, issueTypeId: type.id, statusId: todo.id });
  return { db, drafts, admin, alice, bob, proj, type, priority };
}

describe("draft issues", () => {
  it("creates, reads, updates, lists, and deletes a draft", async () => {
    const w = await world();
    const draft = await w.drafts.createDraftIssue({ actorId: w.alice.id, projectId: w.proj.id, title: "Spike auth" });
    expect(await w.drafts.getDraftIssue({ draftId: draft.id })).toMatchObject({ id: draft.id, title: "Spike auth", authorId: w.alice.id });

    const updated = await w.drafts.updateDraftIssue({ actorId: w.alice.id, draftId: draft.id, title: "Spike OAuth", body: "details" });
    expect(updated).toMatchObject({ title: "Spike OAuth", body: "details" });

    const list = await w.drafts.listDraftIssues({ projectId: w.proj.id, pagination: { limit: 20 } });
    expect(list.items.map((d) => d.id)).toContain(draft.id);

    await w.drafts.deleteDraftIssue({ actorId: w.alice.id, draftId: draft.id });
    await expect(w.drafts.getDraftIssue({ draftId: draft.id })).rejects.toThrow();
    await w.db.destroy();
  });

  it("promotes a draft into a real issue and records the conversion", async () => {
    const w = await world();
    const draft = await w.drafts.createDraftIssue({ actorId: w.alice.id, projectId: w.proj.id, title: "Build login", body: "as a user..." });

    const { issue, conversion } = await w.drafts.convertDraftToIssue({ draftId: draft.id, issueTypeId: w.type.id, priorityId: w.priority.id, actorId: w.alice.id });
    expect(issue).toMatchObject({ subject: "Build login", description: "as a user...", projectId: w.proj.id });
    expect(conversion).toMatchObject({ draftId: draft.id, issueId: issue.id, userId: w.alice.id });
    await w.db.destroy();
  });

  it("rejects a draft write from a non-member", async () => {
    const w = await world();
    await expect(w.drafts.createDraftIssue({ actorId: w.bob.id, projectId: w.proj.id, title: "nope" })).rejects.toThrow();
    await w.db.destroy();
  });
});
