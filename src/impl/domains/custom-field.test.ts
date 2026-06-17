import { describe, it, expect } from "vitest";
import { NotFoundError, ConflictError, ForbiddenError } from "../errors.js";
import { createTestDb, seedAdmin } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { customFieldBehaviors } from "./custom-field.js";

async function setup() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  await seedAdmin(db, "admin");
  return { db, cf: customFieldBehaviors(ctx) };
}

describe("custom field definitions (registry)", () => {
  it("creates, gets, lists, updates, and deletes a definition", async () => {
    const { db, cf } = await setup();
    const def = await cf.createCustomFieldDefinition({
      actorId: "admin", name: "Story Points", fieldType: "integer",
      constraints: { minValue: 0, maxValue: 100 }, scope: {},
    });
    expect(def).toMatchObject({ name: "Story Points", fieldType: "integer" });
    expect(await cf.getCustomFieldDefinition({ fieldId: def.id })).toEqual(def);

    const updated = await cf.updateCustomFieldDefinition({ actorId: "admin", fieldId: def.id, isRequired: true });
    expect(updated.isRequired).toBe(true);

    const list = await cf.listCustomFieldDefinitions({ pagination: { limit: 20 } });
    expect(list.items.map((d) => d.id)).toContain(def.id);

    await cf.deleteCustomFieldDefinition({ actorId: "admin", fieldId: def.id });
    await expect(cf.getCustomFieldDefinition({ fieldId: def.id })).rejects.toBeInstanceOf(NotFoundError);
    await db.destroy();
  });

  it("round-trips JSON fields (possibleValues, constraints, scope)", async () => {
    const { db, cf } = await setup();
    const def = await cf.createCustomFieldDefinition({
      actorId: "admin", name: "Severity", fieldType: "list",
      possibleValues: ["low", "high"], constraints: {}, scope: { issueTypeIds: ["t1"] },
    });
    const got = await cf.getCustomFieldDefinition({ fieldId: def.id });
    expect(got.possibleValues).toEqual(["low", "high"]);
    expect(got.scope.issueTypeIds).toEqual(["t1"]);
    await db.destroy();
  });

  it("filters list by scope (projectId) — global fields and in-scope fields match", async () => {
    const { db, cf } = await setup();
    const global = await cf.createCustomFieldDefinition({ actorId: "admin", name: "G", fieldType: "string", constraints: {}, scope: {} });
    const scoped = await cf.createCustomFieldDefinition({ actorId: "admin", name: "S", fieldType: "string", constraints: {}, scope: { projectIds: ["p1"] } });
    const other = await cf.createCustomFieldDefinition({ actorId: "admin", name: "O", fieldType: "string", constraints: {}, scope: { projectIds: ["p2"] } });
    const list = await cf.listCustomFieldDefinitions({ projectId: "p1", pagination: { limit: 20 } });
    const ids = list.items.map((d) => d.id);
    expect(ids).toContain(global.id);
    expect(ids).toContain(scoped.id);
    expect(ids).not.toContain(other.id);
    await db.destroy();
  });

  it("rejects writes from a non-admin actor", async () => {
    const { db, cf } = await setup();
    await expect(
      cf.createCustomFieldDefinition({ actorId: "nobody", name: "X", fieldType: "string", constraints: {}, scope: {} }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await db.destroy();
  });
});
