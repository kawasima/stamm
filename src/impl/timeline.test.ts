import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-db.js";
import { makeCtx } from "./ctx.js";
import { appendActivity, deriveTimestamps } from "./timeline.js";

function steppingClock(times: string[]): () => string {
  let i = 0;
  return () => times[i++];
}

function countingIds(): () => string {
  let n = 0;
  return () => `a-${++n}`;
}

describe("timeline (ActivityEntry as source of truth for created/updated)", () => {
  it("appends entries and derives createdAt from the 'created' entry, updatedAt from the latest", async () => {
    const db = await createTestDb();
    const ctx = makeCtx(db, {
      genId: countingIds(),
      now: steppingClock([
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:05.000Z",
        "2026-01-01T00:00:10.000Z",
      ]),
    });

    await appendActivity(ctx, db, { projectId: "p1", userId: "u1", action: "created", targetType: "issue", targetId: "i1" });
    await appendActivity(ctx, db, { projectId: "p1", userId: "u1", action: "updated", targetType: "issue", targetId: "i1" });

    const ts = await deriveTimestamps(db, "issue", "i1");
    expect(ts.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(ts.updatedAt).toBe("2026-01-01T00:00:05.000Z");

    await db.destroy();
  });

  it("returns empty timestamps for a target with no activity", async () => {
    const db = await createTestDb();
    expect(await deriveTimestamps(db, "issue", "nope")).toEqual({});
    await db.destroy();
  });
});
