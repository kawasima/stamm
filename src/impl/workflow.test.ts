import { describe, it, expect } from "vitest";
import { ConflictError, ForbiddenError } from "./errors.js";
import { createTestDb } from "./test-db.js";
import { makeCtx, type Ctx } from "./ctx.js";
import { configBehaviors } from "./domains/config.js";
import { workflowConfigBehaviors } from "./domains/workflow-config.js";
import { assertTransitionAllowed, availableTransitions, resolveDefaultStatus } from "./workflow.js";

function countingIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

async function setup() {
  const db = await createTestDb();
  const ctx: Ctx = makeCtx(db, { genId: countingIds() });
  const config = configBehaviors(ctx);
  const wf = workflowConfigBehaviors(ctx);
  // a minimal status set + a type
  const todo = await config.createStatus({ actorId: "u1", name: "Todo", category: "todo", sortOrder: 0 });
  const doing = await config.createStatus({ actorId: "u1", name: "Doing", category: "in_progress", sortOrder: 1 });
  const type = await config.createIssueType({ actorId: "u1", name: "Bug" });
  return { db, ctx, config, wf, todo, doing, type };
}

describe("resolveDefaultStatus", () => {
  it("uses the configured DefaultStatusSetting when present", async () => {
    const { db, wf, doing, type } = await setup();
    await wf.setDefaultStatus({ actorId: "u1", projectId: "p1", issueTypeId: type.id, statusId: doing.id });
    const status = await resolveDefaultStatus(makeCtx(db), "p1", type.id);
    expect(status.id).toBe(doing.id);
    await db.destroy();
  });

  it("falls back to the first 'todo' status by sortOrder when unset", async () => {
    const { db, ctx, todo, type } = await setup();
    const status = await resolveDefaultStatus(ctx, "p1", type.id);
    expect(status.id).toBe(todo.id);
    await db.destroy();
  });

  it("throws when no default and no 'todo' status exist", async () => {
    const db = await createTestDb();
    await expect(resolveDefaultStatus(makeCtx(db), "p1", "t1")).rejects.toBeInstanceOf(ConflictError);
    await db.destroy();
  });
});

describe("workflow transitions", () => {
  it("setWorkflowTransitions replaces all rules for a project+type", async () => {
    const { db, wf, todo, doing, type } = await setup();
    await wf.setWorkflowTransitions({
      actorId: "u1",
      projectId: "p1",
      issueTypeId: type.id,
      transitions: [{ fromStatusId: todo.id, toStatusId: doing.id, roleIds: ["dev"] }],
    });
    const first = await wf.listWorkflowTransitions({ projectId: "p1", issueTypeId: type.id });
    expect(first.transitions).toHaveLength(1);

    // replace with a different set
    await wf.setWorkflowTransitions({ actorId: "u1", projectId: "p1", issueTypeId: type.id, transitions: [] });
    const second = await wf.listWorkflowTransitions({ projectId: "p1", issueTypeId: type.id });
    expect(second.transitions).toHaveLength(0);
    await db.destroy();
  });

  it("availableTransitions filters by the actor's roles; assertTransitionAllowed enforces it", async () => {
    const { db, ctx, wf, todo, doing, type } = await setup();
    await wf.setWorkflowTransitions({
      actorId: "u1",
      projectId: "p1",
      issueTypeId: type.id,
      transitions: [{ fromStatusId: todo.id, toStatusId: doing.id, roleIds: ["dev"] }],
    });
    const scope = { projectId: "p1", issueTypeId: type.id, fromStatusId: todo.id };

    expect(await availableTransitions(ctx, scope, ["dev"])).toHaveLength(1);
    expect(await availableTransitions(ctx, scope, ["qa"])).toHaveLength(0);

    await expect(assertTransitionAllowed(ctx, scope, doing.id, ["dev"])).resolves.toBeUndefined();
    await expect(assertTransitionAllowed(ctx, scope, doing.id, ["qa"])).rejects.toBeInstanceOf(ForbiddenError);
    await db.destroy();
  });
});
