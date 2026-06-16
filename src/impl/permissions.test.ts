import { describe, it, expect } from "vitest";
import { ForbiddenError } from "./errors.js";
import { createTestDb } from "./test-db.js";
import { makeCtx, type Ctx } from "./ctx.js";
import { configBehaviors } from "./domains/config.js";
import { projectBehaviors } from "./domains/project.js";
import { assertCanWrite, hasPermission, isGlobalAdmin, rolesOf } from "./permissions.js";

function countingIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

async function setup() {
  const db = await createTestDb();
  const ctx: Ctx = makeCtx(db, { genId: countingIds() });
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  return { db, ctx, config, project };
}

describe("permissions", () => {
  it("resolves a member's roles and checks role-granted permissions", async () => {
    const { db, ctx, config, project } = await setup();
    const dev = await config.createRole({ actorId: "admin", name: "Dev", permissions: ["issue.create"] });
    const alice = await config.createUser({ actorId: "admin", login: "alice", email: "a@x.io", displayName: "Alice" });
    const p = await project.createProject({ actorId: "admin", identifier: "proj", name: "P" });
    await project.addProjectMember({ actorId: "admin", projectId: p.id, userId: alice.id, roleIds: [dev.id] });

    expect((await rolesOf(ctx, p.id, alice.id)).map((r) => r.name)).toEqual(["Dev"]);
    expect(await hasPermission(ctx, p.id, alice.id, "issue.create")).toBe(true);
    expect(await hasPermission(ctx, p.id, alice.id, "issue.delete")).toBe(false);
    await db.destroy();
  });

  it("treats a kind=admin user as a global admin who bypasses permission checks", async () => {
    const { db, ctx, config } = await setup();
    const root = await config.createUser({ actorId: "admin", login: "root", email: "r@x.io", displayName: "Root", kind: "admin" });
    expect(await isGlobalAdmin(ctx, root.id)).toBe(true);
    // no membership at all, yet permitted because global admin
    expect(await hasPermission(ctx, "any-project", root.id, "issue.delete")).toBe(true);
    await expect(assertCanWrite(ctx, "any-project", root.id, "issue.delete")).resolves.toBeUndefined();
    await db.destroy();
  });

  it("assertCanWrite throws ForbiddenError for a non-member", async () => {
    const { db, ctx, config, project } = await setup();
    const bob = await config.createUser({ actorId: "admin", login: "bob", email: "b@x.io", displayName: "Bob" });
    const p = await project.createProject({ actorId: "admin", identifier: "proj", name: "P" });
    await expect(assertCanWrite(ctx, p.id, bob.id, "issue.create")).rejects.toBeInstanceOf(ForbiddenError);
    await db.destroy();
  });
});
