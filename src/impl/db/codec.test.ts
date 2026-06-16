import { describe, it, expect } from "vitest";
import type { Status, Role } from "../../schema/index.js";
import { Status as StatusSchema, Role as RoleSchema } from "../../schema/index.js";
import { createTestDb } from "../test-db.js";
import { makeCodec } from "./codec.js";

describe("RowCodec (Raoh-style db boundary: decode = zod parse)", () => {
  it("round-trips a status (enum column) through a real sqlite db", async () => {
    const db = await createTestDb();
    const codec = makeCodec(StatusSchema);
    const status: Status = { id: "s1", name: "Todo", category: "todo", sortOrder: 0 };

    await db.insertInto("statuses").values(codec.encode(status) as never).execute();
    const row = await db
      .selectFrom("statuses")
      .selectAll()
      .where("id", "=", "s1")
      .executeTakeFirstOrThrow();

    expect(codec.decode(row)).toEqual(status);
    await db.destroy();
  });

  it("round-trips a role whose permissions array is stored as a JSON column", async () => {
    const db = await createTestDb();
    const codec = makeCodec(RoleSchema, { json: ["permissions"] });
    const role: Role = {
      id: "r1",
      name: "Member",
      permissions: ["issue.create", "issue.update"],
      issuesVisibility: "all",
    };

    await db.insertInto("roles").values(codec.encode(role) as never).execute();
    const row = await db
      .selectFrom("roles")
      .selectAll()
      .where("id", "=", "r1")
      .executeTakeFirstOrThrow();

    expect(codec.decode(row)).toEqual(role);
    await db.destroy();
  });

  it("rejects a corrupt row at the boundary instead of leaking it into the domain", async () => {
    const db = await createTestDb();
    const codec = makeCodec(StatusSchema);

    await db
      .insertInto("statuses")
      .values({ id: "s2", name: "X", category: "bogus_category", sort_order: 0 } as never)
      .execute();
    const row = await db
      .selectFrom("statuses")
      .selectAll()
      .where("id", "=", "s2")
      .executeTakeFirstOrThrow();

    expect(() => codec.decode(row)).toThrow();
    await db.destroy();
  });
});
