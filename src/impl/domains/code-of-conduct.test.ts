import { describe, it, expect } from "vitest";
import { ForbiddenError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { createSqlBehaviors } from "../index.js";
import { buildInstructions } from "../../mcp/instructions.js";

async function world() {
  const db = await createTestDb();
  const full = createSqlBehaviors(db);
  const ctx = makeCtx(db);
  const admin = await full.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await full.createRole({ actorId: admin.id, name: "Dev", permissions: ["comment.create"], issuesVisibility: "all" });
  const a = await full.createProject({ actorId: admin.id, identifier: "aaa", name: "A" });
  const b = await full.createProject({ actorId: admin.id, identifier: "bbb", name: "B" });
  const alice = await full.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  await full.addProjectMember({ actorId: admin.id, projectId: a.id, userId: alice.id, roleIds: [role.id] });
  await full.addProjectMember({ actorId: admin.id, projectId: b.id, userId: alice.id, roleIds: [role.id] });
  return { db, ctx, full, admin, alice, a, b };
}

describe("project Code of Conduct", () => {
  it("is set by an admin, read back with a timestamp, and cleared by an empty string", async () => {
    const w = await world();
    const set = await w.full.updateProject({ actorId: w.admin.id, projectId: w.a.id, codeOfConduct: "Be kind." });
    expect(set.codeOfConduct).toBe("Be kind.");
    expect(set.codeOfConductUpdatedAt).toBeTruthy();
    expect((await w.full.getProject({ actorId: w.alice.id, projectId: w.a.id })).codeOfConduct).toBe("Be kind.");
    // Editing other fields keeps it.
    expect((await w.full.updateProject({ actorId: w.admin.id, projectId: w.a.id, name: "A2" })).codeOfConduct).toBe("Be kind.");
    const cleared = await w.full.updateProject({ actorId: w.admin.id, projectId: w.a.id, codeOfConduct: "" });
    expect(cleared.codeOfConduct).toBeUndefined();
    expect((await w.full.getProject({ actorId: w.alice.id, projectId: w.a.id })).codeOfConduct).toBeUndefined();
  });

  it("can't be changed by a non-admin", async () => {
    const w = await world();
    await expect(w.full.updateProject({ actorId: w.alice.id, projectId: w.a.id, codeOfConduct: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is delivered as connect instructions, limited to the key's projects", async () => {
    const w = await world();
    await w.full.updateProject({ actorId: w.admin.id, projectId: w.a.id, codeOfConduct: "RULE-A" });
    await w.full.updateProject({ actorId: w.admin.id, projectId: w.b.id, codeOfConduct: "RULE-B" });
    const scoped = createSqlBehaviors(w.db, { scope: { projectIds: [w.a.id] } });
    const text = await buildInstructions(scoped, w.alice.id);
    expect(text).toContain("RULE-A");
    expect(text).not.toContain("RULE-B");
    const all = await buildInstructions(w.full, w.alice.id);
    expect(all).toContain("RULE-A");
    expect(all).toContain("RULE-B");
  });

  it("sends no instructions when no project has a Code of Conduct", async () => {
    const w = await world();
    expect(await buildInstructions(w.full, w.alice.id)).toBeUndefined();
  });
});
