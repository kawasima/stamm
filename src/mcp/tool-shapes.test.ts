import { describe, it, expect } from "vitest";
import { connect, stubBehaviors, validIssue } from "./test-helpers.js";

describe("issue_search (list / paginated shape)", () => {
  it("is read-only and dispatches to listIssues, returning a paginated envelope", async () => {
    const calls: unknown[] = [];
    const client = await connect(
      stubBehaviors({
        listIssues: async (args) => {
          calls.push(args);
          return { items: [], totalCount: 0 };
        },
      }),
    );

    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name === "issue_search");
    expect(search).toBeDefined();
    expect(search!.annotations?.readOnlyHint).toBe(true);

    const result = await client.callTool({
      name: "issue_search",
      arguments: { actorId: "u1", filter: {}, pagination: {} },
    });

    expect(calls).toHaveLength(1);
    expect(result.structuredContent).toMatchObject({ items: [], totalCount: 0 });
  });
});

describe("issue_create (write shape)", () => {
  it("dispatches to createIssue and returns the created issue", async () => {
    const calls: unknown[] = [];
    const client = await connect(
      stubBehaviors({
        createIssue: async (args) => {
          calls.push(args);
          return validIssue;
        },
      }),
    );

    const result = await client.callTool({
      name: "issue_create",
      arguments: {
        actorId: "u1",
        projectId: "p1",
        issueTypeId: "t1",
        priorityId: "pr1",
        subject: "New issue",
      },
    });

    expect(calls).toHaveLength(1);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: "i1" });
  });
});

describe("issue_delete (void / destructive shape)", () => {
  it("is marked destructive, dispatches to deleteIssue, and returns no structuredContent", async () => {
    const calls: unknown[] = [];
    const client = await connect(
      stubBehaviors({
        deleteIssue: async (args) => {
          calls.push(args);
        },
      }),
    );

    const { tools } = await client.listTools();
    const del = tools.find((t) => t.name === "issue_delete");
    expect(del).toBeDefined();
    expect(del!.annotations?.destructiveHint).toBe(true);

    const result = await client.callTool({
      name: "issue_delete",
      arguments: { actorId: "u1", issueId: "i1" },
    });

    expect(calls).toEqual([{ actorId: "u1", issueId: "i1" }]);
    expect(result.structuredContent).toBeUndefined();
    expect(result.isError).toBeFalsy();
  });
});
