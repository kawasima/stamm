import { describe, it, expect } from "vitest";
import { connect } from "./test-helpers.js";
import { createSqlBehaviors, makeSqlite, migrateToLatest } from "../impl/index.js";
import type { Behaviors } from "./behaviors.js";

/** Seed a minimal world directly through the behaviors, then return them + ids. */
async function seededBehaviors() {
  const db = makeSqlite(":memory:");
  await migrateToLatest(db);
  const b: Behaviors = createSqlBehaviors(db);

  const admin = await b.createUser({ actorId: "boot", login: "admin", email: "a@x.io", displayName: "Admin", kind: "admin" });
  const role = await b.createRole({ actorId: admin.id, name: "Member", permissions: ["issue.create", "issue.update", "issue.assign", "comment.create"], issuesVisibility: "all" });
  const todo = await b.createStatus({ actorId: admin.id, name: "Todo", category: "todo", sortOrder: 0 });
  const done = await b.createStatus({ actorId: admin.id, name: "Done", category: "done", sortOrder: 1 });
  const priority = await b.createPriority({ actorId: admin.id, name: "Normal" });
  const type = await b.createIssueType({ actorId: admin.id, name: "Bug" });
  const proj = await b.createProject({ actorId: admin.id, identifier: "proj", name: "P" });
  const alice = await b.createUser({ actorId: admin.id, login: "alice", email: "al@x.io", displayName: "Alice" });
  const bob = await b.createUser({ actorId: admin.id, login: "bob", email: "b@x.io", displayName: "Bob" });
  await b.addProjectMember({ actorId: admin.id, projectId: proj.id, userId: alice.id, roleIds: [role.id] });
  await b.setWorkflowTransitions({ actorId: admin.id, projectId: proj.id, issueTypeId: type.id, transitions: [{ fromStatusId: todo.id, toStatusId: done.id, roleIds: [role.id] }] });

  return { b, admin, role, todo, done, priority, type, proj, alice, bob };
}

describe("MCP end-to-end over a real SQL backend", () => {
  it("create → get → search through MCP tools", async () => {
    const w = await seededBehaviors();
    const client = await connect(w.b);
    const base = { actorId: w.alice.id, projectId: w.proj.id, issueTypeId: w.type.id, priorityId: w.priority.id };

    const created = await client.callTool({ name: "issue_create", arguments: { ...base, subject: "Login is broken" } });
    expect(created.isError).toBeFalsy();
    const issueId = (created.structuredContent as { id: string }).id;

    const got = await client.callTool({ name: "issue_get", arguments: { actorId: w.alice.id, issueId } });
    expect(got.structuredContent).toMatchObject({ id: issueId, subject: "Login is broken", key: "proj", number: 1 });

    const search = await client.callTool({ name: "issue_search", arguments: { actorId: w.alice.id, filter: {}, pagination: { limit: 20 } } });
    expect((search.structuredContent as { items: { id: string }[] }).items.map((i) => i.id)).toContain(issueId);
  });

  it("transition → history, and a disallowed transition surfaces as isError", async () => {
    const w = await seededBehaviors();
    const client = await connect(w.b);
    const base = { actorId: w.alice.id, projectId: w.proj.id, issueTypeId: w.type.id, priorityId: w.priority.id };
    const id = ((await client.callTool({ name: "issue_create", arguments: { ...base, subject: "x" } })).structuredContent as { id: string }).id;

    const ok = await client.callTool({ name: "issue_transition", arguments: { actorId: w.alice.id, issueId: id, toStatusId: w.done.id } });
    expect(ok.isError).toBeFalsy();
    const history = await client.callTool({ name: "issue_history", arguments: { issueId: id, pagination: { limit: 20 } } });
    expect((history.structuredContent as { items: unknown[] }).items).toHaveLength(1);

    const bad = await client.callTool({ name: "issue_transition", arguments: { actorId: w.alice.id, issueId: id, toStatusId: w.todo.id } });
    expect(bad.isError).toBe(true);
  });

  it("a non-member create is rejected as isError", async () => {
    const w = await seededBehaviors();
    const client = await connect(w.b);
    const res = await client.callTool({
      name: "issue_create",
      arguments: { actorId: w.bob.id, projectId: w.proj.id, issueTypeId: w.type.id, priorityId: w.priority.id, subject: "nope" },
    });
    expect(res.isError).toBe(true);
  });

  it("the compound issue_update tool fans out to satellites", async () => {
    const w = await seededBehaviors();
    const client = await connect(w.b);
    const base = { actorId: w.alice.id, projectId: w.proj.id, issueTypeId: w.type.id, priorityId: w.priority.id };
    const issue = (await client.callTool({ name: "issue_create", arguments: { ...base, subject: "S" } })).structuredContent as { id: string };

    const updated = await client.callTool({
      name: "issue_update",
      arguments: { actorId: w.alice.id, issueId: issue.id, subject: "Renamed", assigneeIds: [w.bob.id], labelIds: ["l1"] },
    });
    expect(updated.isError).toBeFalsy();
    const detail = updated.structuredContent as { subject: string; assignees: { assigneeId: string }[]; labels: { labelId: string }[] };
    expect(detail.subject).toBe("Renamed");
    expect(detail.assignees.map((a) => a.assigneeId)).toEqual([w.bob.id]);
    expect(detail.labels.map((l) => l.labelId)).toEqual(["l1"]);
  });

  it("pins identity: actorId is hidden from schemas and injected from the pinned actor", async () => {
    const w = await seededBehaviors();
    const client = await connect(w.b, { actorId: w.alice.id });

    const { tools } = await client.listTools();
    const get = tools.find((t) => t.name === "issue_get")!;
    expect(get.inputSchema.properties).not.toHaveProperty("actorId");
    expect(get.inputSchema.properties).toHaveProperty("issueId");

    // no actorId in the call — the server injects the pinned actor (alice)
    const created = await client.callTool({
      name: "issue_create",
      arguments: { projectId: w.proj.id, issueTypeId: w.type.id, priorityId: w.priority.id, subject: "pinned" },
    });
    expect(created.isError).toBeFalsy();
    expect((created.structuredContent as { authorId: string }).authorId).toBe(w.alice.id);
  });

  it("issue writes generate notifications visible through MCP", async () => {
    const w = await seededBehaviors();
    const client = await connect(w.b);
    const base = { actorId: w.alice.id, projectId: w.proj.id, issueTypeId: w.type.id, priorityId: w.priority.id };
    await client.callTool({ name: "issue_create", arguments: { ...base, subject: "S", assigneeIds: [w.bob.id] } });

    const count = await client.callTool({ name: "notification_unread_count", arguments: { recipientId: w.bob.id } });
    expect(count.structuredContent).toMatchObject({ count: 1 });
  });
});
