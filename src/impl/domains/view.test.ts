import { describe, it, expect } from "vitest";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { viewBehaviors } from "./view.js";

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const views = viewBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Lead", permissions: ["view.manage"], issuesVisibility: "all" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  const bob = await config.createUser({ actorId: admin.id, login: "bob", email: "b@x.io", displayName: "Bob" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });
  return { db, views, admin, alice, bob, proj };
}

describe("saved views", () => {
  it("creates a view and reads its filter/columns back intact", async () => {
    const w = await world();
    const v = await w.views.createProjectView({
      actorId: w.alice.id, projectId: w.proj.id, ownerId: w.alice.id, name: "My open work",
      layout: "table", filter: { query: "auth" }, columns: ["subject", "status"], visibility: "private",
    });
    const got = await w.views.getProjectView({ viewId: v.id });
    expect(got).toMatchObject({ name: "My open work", filter: { query: "auth" }, columns: ["subject", "status"], visibility: "private" });
    await w.db.destroy();
  });

  it("scopes private views to their owner when listing", async () => {
    const w = await world();
    const pubBob = await w.views.createProjectView({ actorId: w.alice.id, projectId: w.proj.id, ownerId: w.bob.id, name: "Shared", filter: {}, visibility: "public" });
    const privAlice = await w.views.createProjectView({ actorId: w.alice.id, projectId: w.proj.id, ownerId: w.alice.id, name: "Mine", filter: {}, visibility: "private" });
    const privBob = await w.views.createProjectView({ actorId: w.alice.id, projectId: w.proj.id, ownerId: w.bob.id, name: "Bob's", filter: {}, visibility: "private" });

    const seen = await w.views.listProjectViews({ projectId: w.proj.id, ownerId: w.alice.id, pagination: { limit: 50 } });
    const ids = seen.items.map((v) => v.id);
    expect(ids).toContain(pubBob.id);
    expect(ids).toContain(privAlice.id);
    expect(ids).not.toContain(privBob.id);
    await w.db.destroy();
  });

  it("updates and deletes a view", async () => {
    const w = await world();
    const v = await w.views.createProjectView({ actorId: w.alice.id, projectId: w.proj.id, ownerId: w.alice.id, name: "V", filter: {} });
    const up = await w.views.updateProjectView({ actorId: w.alice.id, viewId: v.id, name: "V2", columns: ["status"] });
    expect(up).toMatchObject({ name: "V2", columns: ["status"] });
    await w.views.deleteProjectView({ actorId: w.alice.id, viewId: v.id });
    await expect(w.views.getProjectView({ viewId: v.id })).rejects.toThrow();
    await w.db.destroy();
  });
});

describe("board card ordering", () => {
  async function board() {
    const w = await world();
    const view = await w.views.createProjectView({ actorId: w.alice.id, projectId: w.proj.id, ownerId: w.alice.id, name: "Board", layout: "board", filter: {} });
    return { ...w, view };
  }

  it("orders cards and inserts between neighbors", async () => {
    const w = await board();
    await w.views.moveIssueOnBoard({ actorId: w.alice.id, viewId: w.view.id, issueId: "i1", position: 1 });
    await w.views.moveIssueOnBoard({ actorId: w.alice.id, viewId: w.view.id, issueId: "i2", position: 2 });
    await w.views.moveIssueOnBoard({ actorId: w.alice.id, viewId: w.view.id, issueId: "i3", beforeIssueId: "i2" });

    const { positions } = await w.views.listBoardPositions({ viewId: w.view.id });
    expect(positions.map((p) => p.issueId)).toEqual(["i1", "i3", "i2"]);

    // re-place i1 after i2: it lands at the end
    await w.views.moveIssueOnBoard({ actorId: w.alice.id, viewId: w.view.id, issueId: "i1", afterIssueId: "i2" });
    const after = await w.views.listBoardPositions({ viewId: w.view.id });
    expect(after.positions.map((p) => p.issueId)).toEqual(["i3", "i2", "i1"]);
    await w.db.destroy();
  });

  it("requires exactly one slot specifier", async () => {
    const w = await board();
    await expect(w.views.moveIssueOnBoard({ actorId: w.alice.id, viewId: w.view.id, issueId: "i1" })).rejects.toThrow();
    await expect(w.views.moveIssueOnBoard({ actorId: w.alice.id, viewId: w.view.id, issueId: "i1", position: 1, beforeIssueId: "i2" })).rejects.toThrow();
    await w.db.destroy();
  });

  it("clears positions when its view is deleted", async () => {
    const w = await board();
    await w.views.moveIssueOnBoard({ actorId: w.alice.id, viewId: w.view.id, issueId: "i1", position: 1 });
    await w.views.deleteProjectView({ actorId: w.alice.id, viewId: w.view.id });
    const { positions } = await w.views.listBoardPositions({ viewId: w.view.id });
    expect(positions).toHaveLength(0);
    await w.db.destroy();
  });
});
