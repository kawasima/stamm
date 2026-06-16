import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Behaviors } from "./behaviors.js";
import { contractArgs, contractReturn, type AnyContract } from "./contract.js";
import { injectActor, stripActor } from "./identity.js";

/**
 * A tool that maps 1:1 onto a single behavior contract: its input schema is the
 * contract's args, its output schema the contract's (non-void) return, and it
 * dispatches straight to one Behaviors method.
 */
export interface SimpleTool {
  name: string;
  description: string;
  contract: AnyContract;
  behavior: keyof Behaviors;
  annotations?: ToolAnnotations;
}

export function registerSimpleTool(
  server: McpServer,
  behaviors: Behaviors,
  def: SimpleTool,
  actorId?: string,
): void {
  const ret = contractReturn(def.contract);
  const outputSchema = ret instanceof z.ZodObject ? ret.shape : undefined;

  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: stripActor(contractArgs(def.contract), actorId),
      ...(outputSchema ? { outputSchema } : {}),
      annotations: def.annotations,
    },
    async (args) => {
      const result = await (behaviors[def.behavior] as (a: unknown) => Promise<unknown>)(
        injectActor(args as Record<string, unknown>, actorId),
      );
      if (outputSchema) {
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      }
      return { content: [{ type: "text", text: "ok" }] };
    },
  );
}
