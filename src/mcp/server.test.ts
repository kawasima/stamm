import { describe, it, expect } from "vitest";
import { connect, stubBehaviors, validIssue } from "./test-helpers.js";

describe("issue_get tool", () => {
  it("is listed as a read-only tool with issueId in its input schema", async () => {
    const client = await connect(stubBehaviors());

    const { tools } = await client.listTools();
    const issueGet = tools.find((t) => t.name === "issue_get");

    expect(issueGet).toBeDefined();
    expect(issueGet!.annotations?.readOnlyHint).toBe(true);
    expect(issueGet!.inputSchema.properties).toHaveProperty("issueId");
  });

  it("advertises an output schema describing the returned issue", async () => {
    const client = await connect(stubBehaviors());

    const { tools } = await client.listTools();
    const issueGet = tools.find((t) => t.name === "issue_get");

    expect(issueGet!.outputSchema).toBeDefined();
    expect(issueGet!.outputSchema!.properties).toHaveProperty("subject");
  });

  it("dispatches to behaviors.getIssue and returns the issue as structuredContent", async () => {
    const calls: unknown[] = [];
    const client = await connect(
      stubBehaviors({
        getIssue: async (args) => {
          calls.push(args);
          return validIssue;
        },
      }),
    );

    const result = await client.callTool({
      name: "issue_get",
      arguments: { actorId: "u1", issueId: "i1" },
    });

    expect(calls).toEqual([{ actorId: "u1", issueId: "i1" }]);
    expect(result.structuredContent).toMatchObject({ id: "i1", subject: "Something is broken" });
    expect(result.isError).toBeFalsy();
  });

  it("turns a business error from the behavior into an isError result, not a protocol error", async () => {
    const client = await connect(
      stubBehaviors({
        getIssue: async () => {
          throw new Error("issue not visible to actor");
        },
      }),
    );

    const result = await client.callTool({
      name: "issue_get",
      arguments: { actorId: "u1", issueId: "i1" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("issue not visible to actor");
  });
});
