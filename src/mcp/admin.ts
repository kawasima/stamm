import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as B from "../behavior/index.js";
import type { Behaviors } from "./behaviors.js";
import { contractArgsObject, type AnyContract } from "./contract.js";
import { injectActor } from "./identity.js";

type ResourceEntry = { contract: AnyContract; behavior: keyof Behaviors };
type ResourceMap = Record<string, ResourceEntry>;

/**
 * The eight config resources collapse their CRUD onto five generic admin_*
 * tools. Each operation is one tool whose input is a discriminated union on
 * `resource`, so every resource keeps its own typed fields in the published
 * schema rather than hiding behind a loose object.
 */
const CREATE: ResourceMap = {
  status: { contract: B.CreateStatus, behavior: "createStatus" },
  priority: { contract: B.CreatePriority, behavior: "createPriority" },
  label: { contract: B.CreateLabel, behavior: "createLabel" },
  issue_type: { contract: B.CreateIssueType, behavior: "createIssueType" },
  category: { contract: B.CreateCategory, behavior: "createCategory" },
  role: { contract: B.CreateRole, behavior: "createRole" },
  user: { contract: B.CreateUser, behavior: "createUser" },
  group: { contract: B.CreateUserGroup, behavior: "createUserGroup" },
  custom_field: { contract: B.CreateCustomFieldDefinition, behavior: "createCustomFieldDefinition" },
};

const GET: ResourceMap = {
  status: { contract: B.GetStatus, behavior: "getStatus" },
  priority: { contract: B.GetPriority, behavior: "getPriority" },
  label: { contract: B.GetLabel, behavior: "getLabel" },
  issue_type: { contract: B.GetIssueType, behavior: "getIssueType" },
  category: { contract: B.GetCategory, behavior: "getCategory" },
  role: { contract: B.GetRole, behavior: "getRole" },
  user: { contract: B.GetUser, behavior: "getUser" },
  group: { contract: B.GetUserGroup, behavior: "getUserGroup" },
  custom_field: { contract: B.GetCustomFieldDefinition, behavior: "getCustomFieldDefinition" },
};

const UPDATE: ResourceMap = {
  status: { contract: B.UpdateStatus, behavior: "updateStatus" },
  priority: { contract: B.UpdatePriority, behavior: "updatePriority" },
  label: { contract: B.UpdateLabel, behavior: "updateLabel" },
  issue_type: { contract: B.UpdateIssueType, behavior: "updateIssueType" },
  category: { contract: B.UpdateCategory, behavior: "updateCategory" },
  role: { contract: B.UpdateRole, behavior: "updateRole" },
  user: { contract: B.UpdateUser, behavior: "updateUser" },
  group: { contract: B.UpdateUserGroup, behavior: "updateUserGroup" },
  custom_field: { contract: B.UpdateCustomFieldDefinition, behavior: "updateCustomFieldDefinition" },
};

const DELETE: ResourceMap = {
  status: { contract: B.DeleteStatus, behavior: "deleteStatus" },
  priority: { contract: B.DeletePriority, behavior: "deletePriority" },
  label: { contract: B.DeleteLabel, behavior: "deleteLabel" },
  issue_type: { contract: B.DeleteIssueType, behavior: "deleteIssueType" },
  category: { contract: B.DeleteCategory, behavior: "deleteCategory" },
  role: { contract: B.DeleteRole, behavior: "deleteRole" },
  user: { contract: B.DeleteUser, behavior: "deleteUser" },
  group: { contract: B.DeleteUserGroup, behavior: "deleteUserGroup" },
  custom_field: { contract: B.DeleteCustomFieldDefinition, behavior: "deleteCustomFieldDefinition" },
};

const LIST: ResourceMap = {
  status: { contract: B.ListStatuses, behavior: "listStatuses" },
  priority: { contract: B.ListPriorities, behavior: "listPriorities" },
  label: { contract: B.ListLabels, behavior: "listLabels" },
  issue_type: { contract: B.ListIssueTypes, behavior: "listIssueTypes" },
  category: { contract: B.ListCategories, behavior: "listCategories" },
  role: { contract: B.ListRoles, behavior: "listRoles" },
  user: { contract: B.ListUsers, behavior: "listUsers" },
  group: { contract: B.ListUserGroups, behavior: "listUserGroups" },
  custom_field: { contract: B.ListCustomFieldDefinitions, behavior: "listCustomFieldDefinitions" },
};

const RESOURCE_LIST = "status, priority, label, issue_type, category, role, user, group, custom_field";

function unionSchema(map: ResourceMap, pinnedActor: boolean) {
  const variants = Object.keys(map).map((resource) => {
    const obj = contractArgsObject(map[resource].contract).extend({ resource: z.literal(resource) });
    return pinnedActor && "actorId" in obj.shape ? obj.omit({ actorId: true }) : obj;
  });
  // runtime shape is correct (each variant carries a `resource` literal); the
  // cast bypasses the discriminated-union tuple typing after the conditional omit.
  return z.discriminatedUnion("resource", variants as never);
}

function registerAdminOp(
  server: McpServer,
  behaviors: Behaviors,
  op: string,
  description: string,
  map: ResourceMap,
  actorId: string | undefined,
  annotations?: ToolAnnotations,
): void {
  server.registerTool(
    `admin_${op}`,
    {
      description,
      // The SDK only publishes the JSON Schema of an object-typed inputSchema,
      // so the resource union lives under a `params` property, not at the root.
      inputSchema: { params: unionSchema(map, !!actorId) },
      ...(annotations ? { annotations } : {}),
    },
    async ({ params }) => {
      const { resource, ...data } = params as { resource: string } & Record<string, unknown>;
      const behavior = behaviors[map[resource].behavior] as (a: unknown) => Promise<unknown>;
      const result = await behavior(injectActor(data, actorId));
      if (result && typeof result === "object") {
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      }
      return { content: [{ type: "text", text: "ok" }] };
    },
  );
}

export function registerAdminTools(server: McpServer, behaviors: Behaviors, actorId?: string): void {
  registerAdminOp(server, behaviors, "create", `Create a config resource (${RESOURCE_LIST}). Set params.resource and that resource's create fields.`, CREATE, actorId);
  registerAdminOp(server, behaviors, "get", `Get a config resource by ID (${RESOURCE_LIST}).`, GET, actorId, { readOnlyHint: true });
  registerAdminOp(server, behaviors, "update", `Update a config resource (${RESOURCE_LIST}).`, UPDATE, actorId, { idempotentHint: true });
  registerAdminOp(server, behaviors, "delete", `Delete a config resource (${RESOURCE_LIST}).`, DELETE, actorId, { destructiveHint: true });
  registerAdminOp(server, behaviors, "list", `List a config resource (${RESOURCE_LIST}).`, LIST, actorId, { readOnlyHint: true });
}
