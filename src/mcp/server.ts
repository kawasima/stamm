import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Behaviors } from "./behaviors.js";
import { registerSimpleTool } from "./registry.js";
import { SIMPLE_TOOLS } from "./catalog.js";
import { registerAdminTools } from "./admin.js";
import { registerIssueUpdateTool } from "./issue-update.js";

export interface StammServerOptions {
  /** Pin the operating identity: `actorId` is hidden from tool schemas and injected at dispatch. */
  actorId?: string;
}

export function createStammServer(behaviors: Behaviors, opts: StammServerOptions = {}): McpServer {
  const server = new McpServer({ name: "stamm", version: "0.1.0" });

  for (const def of SIMPLE_TOOLS) {
    registerSimpleTool(server, behaviors, def, opts.actorId);
  }
  registerIssueUpdateTool(server, behaviors, opts.actorId);
  registerAdminTools(server, behaviors, opts.actorId);

  return server;
}
