import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-db.js";
import { createSqlBehaviors } from "./index.js";
import { ensureBootstrapped } from "./bootstrap.js";

describe("ensureBootstrapped", () => {
  it("seeds a working world the member can immediately operate in", async () => {
    const db = await createTestDb();
    const b = createSqlBehaviors(db);
    const seed = await ensureBootstrapped(b);
    expect(seed?.seeded).toBe(true);

    // the served (non-admin) member can create and transition issues out of the box
    const issue = await b.createIssue({
      actorId: seed!.memberId,
      projectId: seed!.projectId,
      issueTypeId: seed!.issueTypeId,
      priorityId: seed!.priorityId,
      subject: "first issue",
    });
    expect(issue).toMatchObject({ key: "default", number: 1, statusId: seed!.statusIds.todo });

    const moved = await b.transitionIssueStatus({ actorId: seed!.memberId, issueId: issue.id, toStatusId: seed!.statusIds.inProgress });
    expect(moved.statusId).toBe(seed!.statusIds.inProgress);
    await db.destroy();
  });

  it("is idempotent: a second call does nothing", async () => {
    const db = await createTestDb();
    const b = createSqlBehaviors(db);
    await ensureBootstrapped(b);
    expect(await ensureBootstrapped(b)).toBeNull();
    await db.destroy();
  });
});
