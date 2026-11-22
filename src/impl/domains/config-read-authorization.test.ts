import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { createSqlBehaviors } from "../index.js";
import { ensureBootstrapped } from "../bootstrap.js";
import { connect } from "../../mcp/test-helpers.js";
import type { KeyScope } from "../../schema/index.js";

const page = { pagination: { limit: 50 } };

/** A private project full of telling configuration, and a user who is not in it. */
async function world() {
  const db = await createTestDb();
  const b = createSqlBehaviors(db);
  const seed = (await ensureBootstrapped(b))!;
  const actorId = seed.adminId;
  const secret = await b.createProject({ actorId, identifier: "secret", name: "Secret", visibility: "private" });
  const role = (await b.listRoles({ actorId, ...page })).items[0]!;
  const insider = await b.createUser({ actorId, login: "insider", email: "i@x.io", displayName: "Insider" });
  await b.addProjectMember({ actorId, projectId: secret.id, userId: insider.id, roleIds: [role.id] });
  const label = await b.createLabel({ actorId, projectId: secret.id, name: "acquisition", color: "#000000" });
  const category = await b.createCategory({ actorId, projectId: secret.id, name: "Layoffs" });
  const field = await b.createCustomFieldDefinition({ actorId, name: "Price", fieldType: "string", constraints: {}, scope: { projectIds: [secret.id, seed.projectId] } });
  const hidden = await b.createCustomFieldDefinition({ actorId, name: "Target", fieldType: "string", constraints: {}, scope: { projectIds: [secret.id] } });
  const open = await b.createCustomFieldDefinition({ actorId, name: "Everywhere", fieldType: "string", constraints: {}, scope: {} });
  const template = await b.createIssueTemplate({ actorId, projectId: secret.id, name: "Deal", descriptionTemplate: "x" });
  await b.setWorkflowTransitions({ actorId, projectId: secret.id, issueTypeId: seed.issueTypeId, transitions: [{ fromStatusId: seed.statusIds.todo, toStatusId: seed.statusIds.done, roleIds: [] }] });
  await b.setDefaultStatus({ actorId, projectId: secret.id, issueTypeId: seed.issueTypeId, statusId: seed.statusIds.todo });
  return { db, b, seed, secret, insider, label, category, field, hidden, open, template, outsider: seed.memberId };
}
type W = Awaited<ReturnType<typeof world>>;

const projectReads = (w: W, b: W["b"], actorId: string): Record<string, () => Promise<unknown>> => ({
  listLabels: () => b.listLabels({ actorId, projectId: w.secret.id, ...page }),
  getLabel: () => b.getLabel({ actorId, labelId: w.label.id }),
  listCategories: () => b.listCategories({ actorId, projectId: w.secret.id, ...page }),
  getCategory: () => b.getCategory({ actorId, categoryId: w.category.id }),
  listCustomFieldDefinitions: () => b.listCustomFieldDefinitions({ actorId, projectId: w.secret.id, ...page }),
  getCustomFieldDefinition: () => b.getCustomFieldDefinition({ actorId, fieldId: w.hidden.id }),
  listWorkflowTransitions: () => b.listWorkflowTransitions({ actorId, projectId: w.secret.id }),
  getDefaultStatus: () => b.getDefaultStatus({ actorId, projectId: w.secret.id, issueTypeId: w.seed.issueTypeId }),
  listIssueTemplates: () => b.listIssueTemplates({ actorId, projectId: w.secret.id, ...page }),
  getIssueTemplate: () => b.getIssueTemplate({ actorId, templateId: w.template.id }),
  instantiateTemplate: () => b.instantiateTemplate({ actorId, templateId: w.template.id }),
});

describe("a private project's configuration", () => {
  it("is hidden from a non-member, as if absent, and readable by a member and an admin", async () => {
    const w = await world();
    for (const [name, read] of Object.entries(projectReads(w, w.b, w.outsider))) {
      await expect(read(), name).rejects.toBeInstanceOf(NotFoundError);
    }
    for (const actorId of [w.insider.id, w.seed.adminId]) {
      for (const [name, read] of Object.entries(projectReads(w, w.b, actorId))) await expect(read(), name).resolves.toBeDefined();
    }
  });

  it("is hidden from a key limited to another project, even its member's or an admin's", async () => {
    const w = await world();
    const scoped = createSqlBehaviors(w.db, { scope: { projectIds: [w.seed.projectId] } });
    for (const actorId of [w.insider.id, w.seed.adminId]) {
      for (const [name, read] of Object.entries(projectReads(w, scoped, actorId))) {
        await expect(read(), name).rejects.toBeInstanceOf(NotFoundError);
      }
    }
  });

  it("does not show through a custom field shared with a readable project", async () => {
    const w = await world();
    const seen = (await w.b.listCustomFieldDefinitions({ actorId: w.outsider, ...page })).items;
    expect(seen.map((f) => f.name).sort()).toEqual(["Everywhere", "Price"]);
    expect(seen.find((f) => f.id === w.field.id)!.scope.projectIds).toEqual([w.seed.projectId]);
    expect((await w.b.getCustomFieldDefinition({ actorId: w.outsider, fieldId: w.field.id })).scope.projectIds).toEqual([w.seed.projectId]);
    const full = await w.b.getCustomFieldDefinition({ actorId: w.seed.adminId, fieldId: w.field.id });
    expect(full.scope.projectIds).toEqual([w.secret.id, w.seed.projectId]);
  });
});

describe("what a project-limited key can look up", () => {
  const client = (w: W, scope: KeyScope) =>
    connect(createSqlBehaviors(w.db, { scope }), { actorId: w.outsider, scope } as never);

  it("gives it the vocabulary and the people it needs, and nothing about other projects", async () => {
    const w = await world();
    const c = await client(w, { projectIds: [w.seed.projectId] });
    const list = async (resource: string, extra = {}) =>
      c.callTool({ name: "admin_list", arguments: { params: { resource, ...extra, ...page } } });
    for (const r of ["status", "priority", "issue_type", "custom_field"]) {
      const res = await list(r);
      expect(res.isError, r).toBeFalsy();
      expect((res.structuredContent as { items: unknown[] }).items.length, r).toBeGreaterThan(0);
    }
    expect((await list("label", { projectId: w.seed.projectId })).isError).toBeFalsy();
    expect((await list("label", { projectId: w.secret.id })).isError).toBe(true);
    const people = (await list("user")).structuredContent as { items: { login: string }[] };
    expect(people.items.map((u) => u.login)).toEqual(["member"]);
    const insider = await c.callTool({ name: "admin_get", arguments: { params: { resource: "user", userId: w.insider.id } } });
    expect(insider.isError).toBe(true);
    for (const r of ["role", "group"]) expect((await list(r)).isError, r).toBe(true);
  });

  it("refuses roles, groups and account states at the behavior layer too", async () => {
    const w = await world();
    const scoped = createSqlBehaviors(w.db, { scope: { projectIds: [w.seed.projectId] } });
    const actorId = w.seed.adminId;
    await expect(scoped.listRoles({ actorId, ...page })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(scoped.listUserGroups({ actorId, ...page })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(scoped.listGroupMembers({ actorId, groupId: "g", ...page })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(scoped.getUserStatus({ actorId, userId: w.insider.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("offers no admin writes", async () => {
    const w = await world();
    const names = (await (await client(w, { projectIds: [w.seed.projectId] })).listTools()).tools.map((t) => t.name);
    expect(names.filter((n) => n.startsWith("admin_")).sort()).toEqual(["admin_get", "admin_list"]);
    const ro = (await (await client(w, { readOnly: true })).listTools()).tools.map((t) => t.name);
    expect(ro.filter((n) => n.startsWith("admin_")).sort()).toEqual(["admin_get", "admin_list"]);
  });
});
