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

/**
 * Unwrap a contract's return schema to the object it ultimately produces.
 * `nullable` is true when the result may be null/undefined (a natural-key lookup
 * that can miss). We only publish an `outputSchema` for non-nullable objects:
 * the MCP SDK requires `structuredContent` on every call once a tool declares an
 * output schema, which a null result cannot satisfy.
 */
function returnObject(schema: z.ZodTypeAny): { obj?: z.ZodObject<z.ZodRawShape>; nullable: boolean } {
  if (schema instanceof z.ZodObject) return { obj: schema, nullable: false };
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    const inner = schema.unwrap();
    if (inner instanceof z.ZodObject) return { obj: inner, nullable: true };
  }
  return { nullable: false };
}

export function registerSimpleTool(
  server: McpServer,
  behaviors: Behaviors,
  def: SimpleTool,
  actorId?: string,
): void {
  const { obj, nullable } = returnObject(contractReturn(def.contract));
  const outputSchema = obj && !nullable ? obj.shape : undefined;

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
      // A null/undefined result (a lookup that missed) is not an error: report it
      // as a plain, schema-less result so the consumer can branch on absence.
      if (result === null || result === undefined) {
        return { content: [{ type: "text", text: "null" }] };
      }
      if (obj) {
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      }
      return { content: [{ type: "text", text: "ok" }] };
    },
  );
}
