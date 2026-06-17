import { describe, it, expect } from "vitest";
import { ValidationError, ConflictError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { issueBehaviors } from "./issue.js";
import { customFieldBehaviors } from "./custom-field.js";

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const issues = issueBehaviors(ctx);
  const cf = customFieldBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Dev", permissions: ["issue.create", "issue.update"], issuesVisibility: "all" });
  await config.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const priority = await config.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await config.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });

  const base = { issueTypeId: type.id, priorityId: priority.id };
  const create = (customFields?: unknown) =>
    issues.createIssue({ actorId: alice.id, projectId: proj.id, ...base, subject: "S", customFields: customFields as never });
  return { db, config, project, issues, cf, admin, role, priority, type, proj, alice, base, create };
}

describe("issue custom field validation (Schema on Write — ADR-0003)", () => {
  it("rejects a value whose type does not match the definition", async () => {
    const w = await world();
    const f = await w.cf.createCustomFieldDefinition({ actorId: w.admin.id, name: "Points", fieldType: "integer", constraints: {}, scope: {} });
    await expect(w.create([{ fieldId: f.id, value: "not a number" }])).rejects.toBeInstanceOf(ValidationError);
    await w.db.destroy();
  });

  it("accepts a valid value and getIssueDetail returns it", async () => {
    const w = await world();
    const f = await w.cf.createCustomFieldDefinition({ actorId: w.admin.id, name: "Points", fieldType: "integer", constraints: { minValue: 0, maxValue: 100 }, scope: {} });
    const issue = await w.create([{ fieldId: f.id, value: 5 }]);
    const detail = await w.issues.getIssueDetail({ actorId: w.alice.id, issueId: issue.id });
    expect(detail.customFields).toEqual([{ fieldId: f.id, value: 5 }]);
    await w.db.destroy();
  });

  it("enforces constraints (max value)", async () => {
    const w = await world();
    const f = await w.cf.createCustomFieldDefinition({ actorId: w.admin.id, name: "Points", fieldType: "integer", constraints: { maxValue: 10 }, scope: {} });
    await expect(w.create([{ fieldId: f.id, value: 99 }])).rejects.toBeInstanceOf(ValidationError);
    await w.db.destroy();
  });

  it("enforces list membership", async () => {
    const w = await world();
    const f = await w.cf.createCustomFieldDefinition({ actorId: w.admin.id, name: "Severity", fieldType: "list", possibleValues: ["low", "high"], constraints: {}, scope: {} });
    await expect(w.create([{ fieldId: f.id, value: "mid" }])).rejects.toBeInstanceOf(ValidationError);
    const ok = await w.create([{ fieldId: f.id, value: "high" }]);
    expect(ok.customFields).toEqual([{ fieldId: f.id, value: "high" }]);
    await w.db.destroy();
  });

  it("requires a required field going forward", async () => {
    const w = await world();
    const f = await w.cf.createCustomFieldDefinition({ actorId: w.admin.id, name: "Points", fieldType: "integer", isRequired: true, constraints: {}, scope: {} });
    await expect(w.create([])).rejects.toBeInstanceOf(ValidationError);
    const ok = await w.create([{ fieldId: f.id, value: 3 }]);
    expect(ok.customFields).toHaveLength(1);
    await w.db.destroy();
  });

  it("rejects an unknown fieldId", async () => {
    const w = await world();
    await expect(w.create([{ fieldId: "ghost", value: 1 }])).rejects.toBeInstanceOf(ValidationError);
    await w.db.destroy();
  });

  it("rejects a value for a field out of scope for the issue type", async () => {
    const w = await world();
    const f = await w.cf.createCustomFieldDefinition({ actorId: w.admin.id, name: "Scoped", fieldType: "string", constraints: {}, scope: { issueTypeIds: ["other-type"] } });
    await expect(w.create([{ fieldId: f.id, value: "x" }])).rejects.toBeInstanceOf(ValidationError);
    await w.db.destroy();
  });

  it("forbids deleting a definition in use, until its values are cleared", async () => {
    const w = await world();
    const f = await w.cf.createCustomFieldDefinition({ actorId: w.admin.id, name: "Points", fieldType: "integer", constraints: {}, scope: {} });
    const issue = await w.create([{ fieldId: f.id, value: 7 }]);
    await expect(w.cf.deleteCustomFieldDefinition({ actorId: w.admin.id, fieldId: f.id })).rejects.toBeInstanceOf(ConflictError);
    await w.issues.updateIssue({ actorId: w.alice.id, issueId: issue.id, customFields: [] as never });
    await w.cf.deleteCustomFieldDefinition({ actorId: w.admin.id, fieldId: f.id }); // now clear → allowed
    await w.db.destroy();
  });

  it("validates on update too", async () => {
    const w = await world();
    const f = await w.cf.createCustomFieldDefinition({ actorId: w.admin.id, name: "Points", fieldType: "integer", constraints: {}, scope: {} });
    const issue = await w.create([]);
    await expect(
      w.issues.updateIssue({ actorId: w.alice.id, issueId: issue.id, customFields: [{ fieldId: f.id, value: "bad" }] as never }),
    ).rejects.toBeInstanceOf(ValidationError);
    await w.db.destroy();
  });
});
