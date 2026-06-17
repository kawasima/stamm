import { describe, it, expect } from "vitest";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { templateBehaviors } from "./template.js";

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const templates = templateBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Lead", permissions: ["template.manage"], issuesVisibility: "all" });
  const priority = await config.createPriority({ actorId: admin.id, name: "High" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  const bob = await config.createUser({ actorId: admin.id, login: "bob", email: "b@x.io", displayName: "Bob" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });
  return { db, templates, admin, alice, bob, proj, type, priority };
}

describe("issue templates", () => {
  it("creates a template with JSON defaults and reads them back intact", async () => {
    const w = await world();
    const t = await w.templates.createIssueTemplate({
      actorId: w.alice.id, projectId: w.proj.id, name: "Bug report",
      issueTypeId: w.type.id, titlePrefix: "[BUG] ", descriptionTemplate: "## Steps\n",
      defaultPriorityId: w.priority.id, defaultLabelIds: ["l1", "l2"], defaultAssigneeIds: ["u1"],
    });
    const got = await w.templates.getIssueTemplate({ templateId: t.id });
    expect(got).toMatchObject({ name: "Bug report", titlePrefix: "[BUG] ", defaultLabelIds: ["l1", "l2"], defaultAssigneeIds: ["u1"] });

    const list = await w.templates.listIssueTemplates({ projectId: w.proj.id, issueTypeId: w.type.id, pagination: { limit: 20 } });
    expect(list.items.map((x) => x.id)).toContain(t.id);
    await w.db.destroy();
  });

  it("instantiates prepared CreateIssue args, applying titlePrefix and defaults", async () => {
    const w = await world();
    const t = await w.templates.createIssueTemplate({
      actorId: w.alice.id, projectId: w.proj.id, name: "Bug report",
      issueTypeId: w.type.id, titlePrefix: "[BUG] ", descriptionTemplate: "## Steps\n",
      defaultPriorityId: w.priority.id, defaultLabelIds: ["l1"],
    });

    const prepared = await w.templates.instantiateTemplate({ templateId: t.id, subject: "Login fails" });
    expect(prepared).toMatchObject({
      projectId: w.proj.id, issueTypeId: w.type.id, subject: "[BUG] Login fails",
      description: "## Steps\n", priorityId: w.priority.id, labelIds: ["l1"],
    });

    // no subject + a titlePrefix yields just the prefix; without either it falls back to the name
    const noSubject = await w.templates.instantiateTemplate({ templateId: t.id });
    expect(noSubject.subject).toBe("[BUG] ");
    await w.db.destroy();
  });

  it("updates and deletes a template", async () => {
    const w = await world();
    const t = await w.templates.createIssueTemplate({ actorId: w.alice.id, projectId: w.proj.id, name: "T", descriptionTemplate: "x" });
    const up = await w.templates.updateIssueTemplate({ actorId: w.alice.id, templateId: t.id, name: "T2", defaultLabelIds: ["a"] });
    expect(up).toMatchObject({ name: "T2", defaultLabelIds: ["a"] });
    await w.templates.deleteIssueTemplate({ actorId: w.alice.id, templateId: t.id });
    await expect(w.templates.getIssueTemplate({ templateId: t.id })).rejects.toThrow();
    await w.db.destroy();
  });

  it("rejects a template write from a non-member", async () => {
    const w = await world();
    await expect(w.templates.createIssueTemplate({ actorId: w.bob.id, projectId: w.proj.id, name: "nope", descriptionTemplate: "x" })).rejects.toThrow();
    await w.db.destroy();
  });
});
