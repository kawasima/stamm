import { describe, it, expect } from "vitest";
import { connect, stubBehaviors } from "./test-helpers.js";

describe("v1 tool catalog", () => {
  it("registers the operational-core tools across every domain", async () => {
    const client = await connect(stubBehaviors());
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));

    const expected = [
      // issue
      "issue_get", "issue_get_detail", "issue_search", "issue_create", "issue_update",
      "issue_delete", "issue_move", "issue_transition", "issue_history", "issue_watch",
      // relations / comments / attachments
      "issue_relate", "issue_relations", "comment_add", "comment_list", "attachment_add",
      // project
      "project_create", "project_list", "project_archive", "project_member_add",
      // milestone / iteration
      "milestone_create", "milestone_close", "milestone_progress", "iteration_create", "iteration_list",
      // time / notification
      "time_log", "time_summary", "notification_list", "notification_read",
      // workflow / status / user / group
      "workflow_set", "status_default_set", "user_set_status", "group_member_add",
      // admin generic family
      "admin_create", "admin_get", "admin_update", "admin_delete", "admin_list",
    ];

    for (const name of expected) {
      expect(names, `missing tool: ${name}`).toContain(name);
    }
  });

  it("has no duplicate tool names", async () => {
    const client = await connect(stubBehaviors());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it("tags reads read-only and deletes destructive", async () => {
    const client = await connect(stubBehaviors());
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    expect(byName.get("issue_search")!.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("admin_list")!.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("issue_delete")!.annotations?.destructiveHint).toBe(true);
    expect(byName.get("admin_delete")!.annotations?.destructiveHint).toBe(true);
  });
});
