import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Behaviors } from "./behaviors.js";
import { registerSimpleTool } from "./registry.js";
import { SIMPLE_TOOLS } from "./catalog.js";
import { registerAdminTools } from "./admin.js";
import { registerIssueUpdateTool } from "./issue-update.js";
import { toolAllowed } from "./scope.js";
import type { KeyScope } from "../schema/index.js";

export interface StammServerOptions {
  /** Pin the operating identity: `actorId` is hidden from tool schemas and injected at dispatch. */
  actorId?: string;
  /**
   * The scope of the key this server is acting for. Tools the scope doesn't
   * permit are not registered at all, so they are neither listed nor callable.
   * The permission layer enforces the same scope independently (via the Ctx the
   * behaviors were built with); this is the first of the two checks.
   */
  scope?: KeyScope;
  /** Sent to the client on connect; see buildInstructions. */
  instructions?: string;
}

export function createStammServer(behaviors: Behaviors, opts: StammServerOptions = {}): McpServer {
  const server = new McpServer({ name: "stamm", version: "0.1.0" }, opts.instructions ? { instructions: opts.instructions } : undefined);

  const allow = (name: string, readOnly: boolean) => toolAllowed(opts.scope, name, readOnly);
  for (const def of SIMPLE_TOOLS) {
    if (allow(def.name, def.annotations?.readOnlyHint === true)) registerSimpleTool(server, behaviors, def, opts.actorId);
  }
  if (allow("issue_update", false)) registerIssueUpdateTool(server, behaviors, opts.actorId);
  registerAdminTools(server, behaviors, opts.actorId, opts.scope);

  return server;
}
