import { describe, it, expect } from "vitest";
import { connect, stubBehaviors } from "./test-helpers.js";

describe("admin_create (discriminated-union generic tool)", () => {
  it("surfaces per-resource typed variants in its input schema", async () => {
    const client = await connect(stubBehaviors());

    const { tools } = await client.listTools();
    const admin = tools.find((t) => t.name === "admin_create");

    expect(admin).toBeDefined();
    const schema = JSON.stringify(admin!.inputSchema);
    // Each resource's distinct fields must be discoverable, not hidden behind a
    // loose object: label carries projectId, status carries category.
    expect(schema).toContain("status");
    expect(schema).toContain("label");
    expect(schema).toContain("category");
  });

  it("dispatches to the resource's create behavior with resource stripped off", async () => {
    const calls: unknown[] = [];
    const client = await connect(
      stubBehaviors({
        createLabel: async (args) => {
          calls.push(args);
          return { id: "l1", projectId: "p1", name: "bug", color: "#ff0000" };
        },
      }),
    );

    const result = await client.callTool({
      name: "admin_create",
      arguments: {
        params: {
          resource: "label",
          actorId: "u1",
          projectId: "p1",
          name: "bug",
          color: "#ff0000",
        },
      },
    });

    expect(calls).toEqual([
      { actorId: "u1", projectId: "p1", name: "bug", color: "#ff0000" },
    ]);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: "l1" });
  });

  it("rejects fields that do not belong to the chosen resource", async () => {
    const client = await connect(stubBehaviors());

    const result = await client.callTool({
      name: "admin_create",
      // A resource outside the union must be rejected by input validation.
      arguments: { params: { resource: "not_a_resource", name: "x" } },
    });

    expect(result.isError).toBe(true);
  });
});
