import { describe, it, expect } from "vitest";
import { ConflictError, NotFoundError } from "../errors.js";
import { createTestDb, seedAdmin } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { projectBehaviors } from "./project.js";

function countingIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

async function setup() {
  const db = await createTestDb();
  const ctx = makeCtx(db, { genId: countingIds() });
  await seedAdmin(db, "u1"); // "u1" is the admin actor these tests already use
  return { db, b: projectBehaviors(ctx) };
}

describe("project domain", () => {
  it("creates a project (with a default-active category) and reads it back by id and identifier", async () => {
    const { db, b } = await setup();
    const p = await b.createProject({ actorId: "u1", identifier: "proj", name: "Project One" });
    expect(p).toMatchObject({ identifier: "proj", name: "Project One" });
    expect(await b.getProject({ projectId: p.id })).toEqual(p);
    expect(await b.getProjectByIdentifier({ identifier: "proj" })).toEqual(p);
    await db.destroy();
  });

  it("getProjectByIdentifier returns null for an unknown identifier (not an error)", async () => {
    const { db, b } = await setup();
    expect(await b.getProjectByIdentifier({ identifier: "ghost" })).toBeNull();
    await db.destroy();
  });

  it("archives, unarchives, and changes visibility via the project's category", async () => {
    const { db, b } = await setup();
    const p = await b.createProject({ actorId: "u1", identifier: "proj", name: "P" });
    expect((await b.archiveProject({ actorId: "u1", projectId: p.id })).lifecycle).toBe("archived");
    expect((await b.unarchiveProject({ actorId: "u1", projectId: p.id })).lifecycle).toBe("active");
    expect((await b.setProjectVisibility({ actorId: "u1", projectId: p.id, visibility: "private" })).visibility).toBe("private");
    await db.destroy();
  });

  it("filters listProjects by lifecycle and by member", async () => {
    const { db, b } = await setup();
    const a = await b.createProject({ actorId: "u1", identifier: "a", name: "A" });
    const c = await b.createProject({ actorId: "u1", identifier: "c", name: "C" });
    await b.archiveProject({ actorId: "u1", projectId: c.id });
    await b.addProjectMember({ actorId: "u1", projectId: a.id, userId: "alice", roleIds: ["r1"] });

    const active = await b.listProjects({ lifecycle: "active", pagination: { limit: 20 } });
    expect(active.items.map((p) => p.identifier)).toEqual(["a"]);

    const alices = await b.listProjects({ memberUserId: "alice", pagination: { limit: 20 } });
    expect(alices.items.map((p) => p.id)).toEqual([a.id]);
    await db.destroy();
  });

  it("manages members: add (rejecting duplicates), update roles, remove", async () => {
    const { db, b } = await setup();
    const p = await b.createProject({ actorId: "u1", identifier: "proj", name: "P" });
    const m = await b.addProjectMember({ actorId: "u1", projectId: p.id, userId: "alice", roleIds: ["r1"] });
    expect(m).toMatchObject({ projectId: p.id, userId: "alice", roleIds: ["r1"] });

    await expect(b.addProjectMember({ actorId: "u1", projectId: p.id, userId: "alice", roleIds: ["r2"] })).rejects.toBeInstanceOf(ConflictError);

    const updated = await b.updateProjectMember({ actorId: "u1", projectId: p.id, userId: "alice", roleIds: ["r1", "r2"] });
    expect(updated.roleIds).toEqual(["r1", "r2"]);

    const members = await b.listProjectMembers({ projectId: p.id, pagination: { limit: 20 } });
    expect(members.items).toHaveLength(1);

    await b.removeProjectMember({ actorId: "u1", projectId: p.id, userId: "alice" });
    await expect(b.removeProjectMember({ actorId: "u1", projectId: p.id, userId: "alice" })).rejects.toBeInstanceOf(NotFoundError);
    await db.destroy();
  });

  it("deletes a project and its satellites", async () => {
    const { db, b } = await setup();
    const p = await b.createProject({ actorId: "u1", identifier: "proj", name: "P" });
    await b.addProjectMember({ actorId: "u1", projectId: p.id, userId: "alice", roleIds: ["r1"] });
    await b.deleteProject({ actorId: "u1", projectId: p.id });
    await expect(b.getProject({ projectId: p.id })).rejects.toBeInstanceOf(NotFoundError);
    const members = await b.listProjectMembers({ projectId: p.id, pagination: { limit: 20 } });
    expect(members.items).toHaveLength(0);
    await db.destroy();
  });
});
