// Quickstart: create and read an issue through the stamm MCP server (stdio).
// Run after `npm run build`:  node sim/quickstart.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Spawn the stdio server. STAMM_DB points at a throwaway file; on first run it
// bootstraps a Default Project plus a Task type and a Normal priority, and the
// transport pins us to the seeded member — so calls never carry an actorId.
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/bin/stamm-mcp.js"],
  env: { ...process.env, STAMM_DB: "quickstart.db" },
});
const client = new Client({ name: "quickstart", version: "0" });
await client.connect(transport);

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${JSON.stringify(res.content)}`);
  return res.structuredContent;
};

// Reads stay open to members, so resolve the seeded ids we need to file an issue.
const project = await call("project_get_by_identifier", { identifier: "default" });
const page = { pagination: { limit: 20 } };
const types = await call("admin_list", { params: { resource: "issue_type", ...page } });
const priorities = await call("admin_list", { params: { resource: "priority", ...page } });

// Create one issue, then read it back by its returned id.
const created = await call("issue_create", {
  projectId: project.id,
  issueTypeId: types.items[0].id,
  priorityId: priorities.items[0].id,
  subject: "Login is broken",
});
const issue = await call("issue_get", { issueId: created.id });
console.log(`created ${issue.key}-${issue.number}: ${issue.subject}`);

await client.close();
