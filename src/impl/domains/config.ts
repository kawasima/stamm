import type { Kysely } from "kysely";
import type { z } from "zod";
import {
  Category,
  IssueType,
  Label,
  Priority,
  Role,
  Status,
  User,
  UserGroup,
} from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec, type CodecOptions } from "../db/codec.js";
import { buildPage, decodeCursor } from "../pagination.js";
import { assertGlobalAdmin } from "../permissions.js";

interface Paginated<T> {
  items: T[];
  nextCursor?: string;
  totalCount?: number;
}

interface CrudDef<S extends z.ZodTypeAny> {
  table: string;
  schema: S;
  /** Arg field that carries the id on get/update/delete (e.g. "statusId"). */
  idArg: string;
  /** Entity label for NotFound errors. */
  entityName: string;
  /** Domain fields stored as JSON text. */
  json?: string[];
  /** Whether the table has a project_id column (enables a projectId list filter). */
  projectScoped?: boolean;
  /**
   * Authorize a write (create/update/delete). Defaults to global-admin-only:
   * config resources (statuses, roles, users, …) are administration, so a
   * non-admin actor must be rejected before any row is touched. Reads (get/list)
   * stay open so members can resolve statuses/labels/roles for normal work.
   */
  writeGuard?: (ctx: Ctx, args: Record<string, unknown>) => Promise<void>;
}

/**
 * Generic CRUD for a config resource. The eight config tables are structurally
 * uniform (create-from-args, get/update/delete by id, keyset list), so one
 * helper covers them; the codec re-establishes per-resource typing at the
 * boundary. Dynamic table names defeat Kysely's static column typing, so the db
 * is used untyped here — the Zod codec is the type guarantee.
 */
function makeCrud<S extends z.ZodTypeAny>(ctx: Ctx, def: CrudDef<S>) {
  type R = z.infer<S>;
  const codec = makeCodec(def.schema, { json: def.json } as CodecOptions);
  const db = ctx.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
  const guardWrite = def.writeGuard ?? ((c, a) => assertGlobalAdmin(c, a.actorId as string));

  const create = async (args: Record<string, unknown>): Promise<R> => {
    await guardWrite(ctx, args);
    const { actorId: _actor, ...fields } = args;
    const entity = def.schema.parse({ id: ctx.genId(), ...fields }) as R;
    await db.insertInto(def.table).values(codec.encode(entity)).execute();
    return entity;
  };

  const get = async (args: Record<string, unknown>): Promise<R> => {
    const id = args[def.idArg] as string;
    const row = await db.selectFrom(def.table).selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundError(def.entityName, id);
    return codec.decode(row);
  };

  const update = async (args: Record<string, unknown>): Promise<R> => {
    await guardWrite(ctx, args);
    const id = args[def.idArg] as string;
    const row = await db.selectFrom(def.table).selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundError(def.entityName, id);
    const current = codec.decode(row) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (k !== "actorId" && k !== def.idArg && v !== undefined) patch[k] = v;
    }
    const merged = def.schema.parse({ ...current, ...patch, id }) as R;
    await db.updateTable(def.table).set(codec.encode(merged)).where("id", "=", id).execute();
    return merged;
  };

  const remove = async (args: Record<string, unknown>): Promise<void> => {
    await guardWrite(ctx, args);
    const id = args[def.idArg] as string;
    const res = await db.deleteFrom(def.table).where("id", "=", id).executeTakeFirst();
    if (Number(res.numDeletedRows ?? 0) === 0) throw new NotFoundError(def.entityName, id);
  };

  const list = async (args: Record<string, unknown>): Promise<Paginated<R>> => {
    const pagination = (args.pagination ?? {}) as { cursor?: string; limit?: number };
    const limit = pagination.limit ?? 20;
    const cursor = decodeCursor(pagination.cursor);
    let q = db.selectFrom(def.table).selectAll();
    if (def.projectScoped && typeof args.projectId === "string") {
      q = q.where("project_id", "=", args.projectId);
    }
    if (cursor) q = q.where("id", ">", cursor);
    const rows = await q.orderBy("id").limit(limit + 1).execute();
    const page = buildPage(rows.map((r) => codec.decode(r)), (e) => (e as { id: string }).id, limit);
    return { items: page.items, nextCursor: page.nextCursor };
  };

  return { create, get, update, remove, list };
}

type ConfigMethods =
  | "createStatus" | "getStatus" | "updateStatus" | "deleteStatus" | "listStatuses"
  | "createPriority" | "getPriority" | "updatePriority" | "deletePriority" | "listPriorities"
  | "createLabel" | "getLabel" | "updateLabel" | "deleteLabel" | "listLabels"
  | "createIssueType" | "getIssueType" | "updateIssueType" | "deleteIssueType" | "listIssueTypes"
  | "createCategory" | "getCategory" | "updateCategory" | "deleteCategory" | "listCategories"
  | "createRole" | "getRole" | "updateRole" | "deleteRole" | "listRoles"
  | "createUser" | "getUser" | "updateUser" | "deleteUser" | "listUsers"
  | "createUserGroup" | "getUserGroup" | "updateUserGroup" | "deleteUserGroup" | "listUserGroups";

export function configBehaviors(ctx: Ctx): Pick<Behaviors, ConfigMethods> {
  const status = makeCrud(ctx, { table: "statuses", schema: Status, idArg: "statusId", entityName: "Status" });
  const priority = makeCrud(ctx, { table: "priorities", schema: Priority, idArg: "priorityId", entityName: "Priority" });
  const label = makeCrud(ctx, { table: "labels", schema: Label, idArg: "labelId", entityName: "Label", projectScoped: true });
  const issueType = makeCrud(ctx, { table: "issue_types", schema: IssueType, idArg: "issueTypeId", entityName: "IssueType" });
  const category = makeCrud(ctx, { table: "categories", schema: Category, idArg: "categoryId", entityName: "Category", projectScoped: true });
  const role = makeCrud(ctx, { table: "roles", schema: Role, idArg: "roleId", entityName: "Role", json: ["permissions"] });
  // Users are global-admin-only to write, EXCEPT the very first user on an empty
  // database: someone has to mint the bootstrap admin before any admin exists.
  // Once any user exists this falls back to the admin check, so it can't be used
  // to escalate later (update/delete also 404 on an empty DB, so the carve-out
  // is harmless there).
  const userGuard = async (c: Ctx, args: Record<string, unknown>): Promise<void> => {
    const anyUser = await c.db.selectFrom("users").select("id").executeTakeFirst();
    if (!anyUser) return;
    await assertGlobalAdmin(c, args.actorId as string);
  };
  const user = makeCrud(ctx, { table: "users", schema: User, idArg: "userId", entityName: "User", writeGuard: userGuard });
  const group = makeCrud(ctx, { table: "user_groups", schema: UserGroup, idArg: "groupId", entityName: "UserGroup" });

  return {
    createStatus: status.create, getStatus: status.get, updateStatus: status.update, deleteStatus: status.remove, listStatuses: status.list,
    createPriority: priority.create, getPriority: priority.get, updatePriority: priority.update, deletePriority: priority.remove, listPriorities: priority.list,
    createLabel: label.create, getLabel: label.get, updateLabel: label.update, deleteLabel: label.remove, listLabels: label.list,
    createIssueType: issueType.create, getIssueType: issueType.get, updateIssueType: issueType.update, deleteIssueType: issueType.remove, listIssueTypes: issueType.list,
    createCategory: category.create, getCategory: category.get, updateCategory: category.update, deleteCategory: category.remove, listCategories: category.list,
    createRole: role.create, getRole: role.get, updateRole: role.update, deleteRole: role.remove, listRoles: role.list,
    createUser: user.create, getUser: user.get, updateUser: user.update, deleteUser: user.remove, listUsers: user.list,
    createUserGroup: group.create, getUserGroup: group.get, updateUserGroup: group.update, deleteUserGroup: group.remove, listUserGroups: group.list,
  } as Pick<Behaviors, ConfigMethods>;
}
