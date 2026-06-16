import { describe, it, expect } from "vitest";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { projectBehaviors } from "./project.js";
import { timeEntryBehaviors } from "./time-entry.js";

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const project = projectBehaviors(ctx);
  const time = timeEntryBehaviors(ctx);

  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await config.createRole({ actorId: admin.id, name: "Worker", permissions: ["time_entry.create", "time_entry.update", "time_entry.delete"], issuesVisibility: "all" });
  const proj = await project.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  await project.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });
  return { db, config, project, time, admin, proj, alice };
}

describe("time entries", () => {
  it("logs, updates, lists (filtered), and deletes", async () => {
    const w = await world();
    const e = await w.time.createTimeEntry({ actorId: w.alice.id, projectId: w.proj.id, userId: w.alice.id, activityId: "dev", hours: 2, spentOn: "2026-01-02" });
    await w.time.createTimeEntry({ actorId: w.alice.id, projectId: w.proj.id, userId: w.alice.id, activityId: "dev", hours: 3, spentOn: "2026-01-01" });

    const updated = await w.time.updateTimeEntry({ actorId: w.alice.id, timeEntryId: e.id, hours: 5 });
    expect(updated.hours).toBe(5);

    const bySpentOn = await w.time.listTimeEntries({ userId: w.alice.id, sortBy: "spentOn", pagination: { limit: 20 } });
    expect(bySpentOn.items.map((t) => t.spentOn)).toEqual(["2026-01-01", "2026-01-02"]);

    await w.time.deleteTimeEntry({ actorId: w.alice.id, timeEntryId: e.id });
    await expect(w.time.getTimeEntry({ timeEntryId: e.id })).rejects.toBeInstanceOf(NotFoundError);
    await w.db.destroy();
  });

  it("summarizes hours grouped by user (with display-name labels) and by date", async () => {
    const w = await world();
    await w.time.createTimeEntry({ actorId: w.alice.id, projectId: w.proj.id, userId: w.alice.id, activityId: "dev", hours: 2, spentOn: "2026-01-01" });
    await w.time.createTimeEntry({ actorId: w.alice.id, projectId: w.proj.id, userId: w.alice.id, activityId: "dev", hours: 3, spentOn: "2026-01-02" });

    const byUser = await w.time.getTimeSummary({ projectId: w.proj.id, groupBy: "user" });
    expect(byUser.totalHours).toBe(5);
    expect(byUser.groups).toEqual([{ key: w.alice.id, label: "Alice", hours: 5 }]);

    const byDate = await w.time.getTimeSummary({ projectId: w.proj.id, groupBy: "date" });
    expect(byDate.groups.map((g) => [g.key, g.hours])).toEqual([["2026-01-01", 2], ["2026-01-02", 3]]);
    await w.db.destroy();
  });

  it("gates logging on the time_entry.create permission", async () => {
    const w = await world();
    const bob = await w.config.createUser({ actorId: w.admin.id, login: "bob", email: "b@x.io", displayName: "Bob" });
    const noPerm = await w.config.createRole({ actorId: w.admin.id, name: "NoTime", permissions: [], issuesVisibility: "all" });
    await w.project.addProjectMember({ actorId: w.admin.id, projectId: w.proj.id, userId: bob.id, roleIds: [noPerm.id] });
    await expect(w.time.createTimeEntry({ actorId: bob.id, projectId: w.proj.id, userId: bob.id, activityId: "dev", hours: 1, spentOn: "2026-01-01" })).rejects.toBeInstanceOf(ForbiddenError);
    await w.db.destroy();
  });
});
