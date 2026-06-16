import { describe, it, expect } from "vitest";
import { NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";

function countingIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

async function setup() {
  const db = await createTestDb();
  const ctx = makeCtx(db, { genId: countingIds() });
  return { db, b: configBehaviors(ctx) };
}

describe("config domain — status CRUD via the generic helper", () => {
  it("creates a status, generating an id, and reads it back", async () => {
    const { db, b } = await setup();
    const created = await b.createStatus({ actorId: "u1", name: "Todo", category: "todo" });
    expect(created).toMatchObject({ id: "id-1", name: "Todo", category: "todo", sortOrder: 0 });

    const got = await b.getStatus({ statusId: "id-1" });
    expect(got).toEqual(created);
    await db.destroy();
  });

  it("updates only the supplied fields", async () => {
    const { db, b } = await setup();
    await b.createStatus({ actorId: "u1", name: "Todo", category: "todo", sortOrder: 5 });
    const updated = await b.updateStatus({ actorId: "u1", statusId: "id-1", name: "In Progress", category: "in_progress" });
    expect(updated).toMatchObject({ id: "id-1", name: "In Progress", category: "in_progress", sortOrder: 5 });
    await db.destroy();
  });

  it("deletes a status, after which get throws NotFound", async () => {
    const { db, b } = await setup();
    await b.createStatus({ actorId: "u1", name: "Todo", category: "todo" });
    await b.deleteStatus({ actorId: "u1", statusId: "id-1" });
    await expect(b.getStatus({ statusId: "id-1" })).rejects.toBeInstanceOf(NotFoundError);
    await db.destroy();
  });

  it("lists statuses with keyset pagination", async () => {
    const { db, b } = await setup();
    await b.createStatus({ actorId: "u1", name: "A", category: "todo" });
    await b.createStatus({ actorId: "u1", name: "B", category: "in_progress" });
    await b.createStatus({ actorId: "u1", name: "C", category: "done" });

    const first = await b.listStatuses({ pagination: { limit: 2 } });
    expect(first.items.map((s) => s.name)).toEqual(["A", "B"]);
    expect(first.nextCursor).toBeDefined();

    const second = await b.listStatuses({ pagination: { limit: 2, cursor: first.nextCursor } });
    expect(second.items.map((s) => s.name)).toEqual(["C"]);
    expect(second.nextCursor).toBeUndefined();
    await db.destroy();
  });
});

describe("config domain — other resources via the same helper", () => {
  it("round-trips a role's JSON permissions array", async () => {
    const { db, b } = await setup();
    const role = await b.createRole({
      actorId: "u1",
      name: "Member",
      permissions: ["issue.create", "issue.update"],
    });
    expect(role).toMatchObject({ id: "id-1", permissions: ["issue.create", "issue.update"], issuesVisibility: "all" });
    expect(await b.getRole({ roleId: "id-1" })).toEqual(role);
    await db.destroy();
  });

  it("applies schema defaults on create (user language/kind)", async () => {
    const { db, b } = await setup();
    const user = await b.createUser({ actorId: "u1", login: "alice", email: "alice@example.com", displayName: "Alice" });
    expect(user).toMatchObject({ id: "id-1", login: "alice", language: "en", kind: "regular" });
    await db.destroy();
  });

  it("scopes a project-scoped list (labels) by projectId", async () => {
    const { db, b } = await setup();
    await b.createLabel({ actorId: "u1", projectId: "p1", name: "bug", color: "#ff0000" });
    await b.createLabel({ actorId: "u1", projectId: "p2", name: "chore", color: "#00ff00" });

    const p1 = await b.listLabels({ projectId: "p1", pagination: { limit: 20 } });
    expect(p1.items.map((l) => l.name)).toEqual(["bug"]);
    await db.destroy();
  });
});
