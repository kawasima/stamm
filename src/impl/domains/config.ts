import { sql, type Kysely, type RawBuilder } from "kysely";
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
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import { makeCodec, type CodecOptions } from "../db/codec.js";
import { contains, listPage, text, type Dir, type SortKey } from "../listing.js";
import { assertCanReadProject, assertGlobalAdmin, assertNotLastAdmin, canReadProject, isGlobalAdmin, projectUser } from "../permissions.js";

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
  /**
   * The rows belong to a project: reads require that project to be readable, and
   * list is always within one project. Without this, a resource is workspace
   * vocabulary (statuses, priorities, issue types) that any actor may read.
   */
  projectScoped?: boolean;
  /** Not readable with a project-limited key: the rows say who holds what across projects. */
  workspaceOnly?: boolean;
  /** Columns holding a JSON list of this resource's ids, which no foreign key guards. */
  listedIn?: { table: string; column: string }[];
  /** Further conditions on changing or deleting a row. */
  guardChange?: (id: string, patch: Record<string, unknown> | undefined) => Promise<void>;
  /** The order rows are listed in, by id if not given. May depend on the arguments. */
  sort?: (args: Record<string, unknown>) => { by: string; keys: SortKey[] };
  /** A condition for each further argument of the list contract. */
  filters?: Record<string, (value: never, args: Record<string, unknown>) => RawBuilder<boolean> | Promise<RawBuilder<boolean>>>;
  /** Narrow which rows a reader sees. Applied to get and list alike. */
  readFilter?: (ctx: Ctx, args: Record<string, unknown>) => ((q: ConfigQuery) => ConfigQuery) | undefined;
  /**
   * Authorize a write (create/update/delete). Defaults to global-admin-only:
   * config resources (statuses, roles, users, …) are administration, so a
   * non-admin actor must be rejected before any row is touched.
   */
  writeGuard?: (ctx: Ctx, args: Record<string, unknown>) => Promise<void>;
  /**
   * Reduce a row before it leaves a read (get/list). Returns a per-call mapper
   * so any viewer lookup (e.g. "is the actor an admin?") happens once, not per
   * row. Used by `users` to drop email from non-admin readers; other resources
   * leave it unset and return rows verbatim.
   */
  readProjection?: (ctx: Ctx, args: Record<string, unknown>) => Promise<(row: z.infer<S>) => z.infer<S>>;
}

// Dynamic table names defeat Kysely's typing here; see makeCrud.
type ConfigQuery = any;

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

  const guardRead = (): void => {
    if (def.workspaceOnly && ctx.scope?.projectIds) {
      throw new ForbiddenError(`${def.entityName} is not readable with a project-limited key`);
    }
  };

  const get = async (args: Record<string, unknown>): Promise<R> => {
    guardRead();
    const id = args[def.idArg] as string;
    const narrow = def.readFilter?.(ctx, args);
    const query = db.selectFrom(def.table).selectAll().where("id", "=", id);
    const row = await (narrow ? (narrow(query) as typeof query) : query).executeTakeFirst();
    if (!row) throw new NotFoundError(def.entityName, id);
    if (def.projectScoped && !(await canReadProject(ctx, row.project_id as string, args.actorId as string))) {
      throw new NotFoundError(def.entityName, id);
    }
    const entity = codec.decode(row);
    if (def.readProjection) return (await def.readProjection(ctx, args))(entity);
    return entity;
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
    await def.guardChange?.(id, patch);
    const merged = def.schema.parse({ ...current, ...patch, id }) as R;
    await db.updateTable(def.table).set(codec.encode(merged)).where("id", "=", id).execute();
    return merged;
  };

  const remove = async (args: Record<string, unknown>): Promise<void> => {
    await guardWrite(ctx, args);
    const id = args[def.idArg] as string;
    await def.guardChange?.(id, undefined);
    let q = db.deleteFrom(def.table).where("id", "=", id);
    for (const { table, column } of def.listedIn ?? []) {
      q = q.where(sql<boolean>`not exists(select 1 from ${sql.table(table)} t, json_each(t.${sql.ref(column)}) j where j.value = ${id})`);
    }
    const res = await q.executeTakeFirst();
    if (Number(res.numDeletedRows ?? 0) > 0) return;
    const exists = await db.selectFrom(def.table).select("id").where("id", "=", id).executeTakeFirst();
    if (!exists) throw new NotFoundError(def.entityName, id);
    throw new ConflictError("It is in use and cannot be deleted");
  };

  const list = async (args: Record<string, unknown>): Promise<Paginated<R>> => {
    guardRead();
    if (def.projectScoped) await assertCanReadProject(ctx, args.projectId as string, args.actorId as string);
    let q = db.selectFrom(def.table).selectAll();
    if (def.projectScoped) q = q.where("project_id", "=", args.projectId as string);
    const narrow = def.readFilter?.(ctx, args);
    if (narrow) q = narrow(q) as typeof q;
    for (const [arg, condition] of Object.entries(def.filters ?? {})) {
      if (args[arg] !== undefined) q = q.where(await condition(args[arg] as never, args));
    }
    const sort = def.sort?.(args) ?? { by: "id", keys: [] };
    const page = await listPage(q, { name: `${def.table} ${sort.by}`, keys: sort.keys }, `${def.table}.id`, args.pagination as never);
    let items = page.items.map((r) => codec.decode(r) as R);
    if (def.readProjection) items = items.map(await def.readProjection(ctx, args));
    return { items, nextCursor: page.nextCursor };
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
  const inOrder = () => ({ by: "order", keys: [{ by: sql.ref("sort_order"), dir: "asc" as const }, text("name", "asc")] });
  const byName = () => ({ by: "name", keys: [text("name", "asc")] });
  const status = makeCrud(ctx, { table: "statuses", schema: Status, idArg: "statusId", entityName: "Status", sort: inOrder, filters: { category: (v: string) => sql<boolean>`category = ${v}` } });
  const priority = makeCrud(ctx, { table: "priorities", schema: Priority, idArg: "priorityId", entityName: "Priority", sort: inOrder });
  const label = makeCrud(ctx, { table: "labels", schema: Label, idArg: "labelId", entityName: "Label", projectScoped: true, sort: byName, filters: { query: (v: string) => contains(sql.ref("name"), v) } });
  const issueType = makeCrud(ctx, { table: "issue_types", schema: IssueType, idArg: "issueTypeId", entityName: "IssueType", sort: inOrder });
  const category = makeCrud(ctx, { table: "categories", schema: Category, idArg: "categoryId", entityName: "Category", projectScoped: true, sort: byName });
  const role = makeCrud(ctx, { table: "roles", schema: Role, idArg: "roleId", entityName: "Role", json: ["permissions"], workspaceOnly: true, sort: byName, listedIn: [{ table: "workflow_transitions", column: "role_ids" }] });
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
  // Users ride the generic read path like the other config resources, but their
  // rows carry email/admin-flag PII, so reads project the row down for anyone who
  // is not a global admin (and not looking at their own record).
  const userReadProjection = async (c: Ctx, args: Record<string, unknown>) => {
    const viewerId = args.actorId as string | undefined;
    const viewerIsAdmin = viewerId !== undefined && (await isGlobalAdmin(c, viewerId));
    return (u: z.infer<typeof User>) => projectUser(u, viewerId, viewerIsAdmin) as z.infer<typeof User>;
  };
  // A project-limited key sees the people it can work with: members of its
  // projects, and its own user.
  const userReadFilter = (c: Ctx, args: Record<string, unknown>) => {
    const ids = c.scope?.projectIds;
    if (!ids) return undefined;
    return (q: ConfigQuery) =>
      q.where((eb: any) =>
        eb.or([
          eb("users.id", "=", args.actorId as string),
          eb("users.id", "in", eb.selectFrom("project_memberships").select("user_id").where("project_id", "in", ids)),
        ]),
      );
  };
  const user = makeCrud(ctx, { table: "users", schema: User, idArg: "userId", entityName: "User", writeGuard: userGuard, readProjection: userReadProjection, readFilter: userReadFilter,
    sort: (args) => {
      const by = (args.sortBy as "login" | "displayName" | "email" | undefined) ?? "login";
      return { by, keys: [text({ login: "login", displayName: "display_name", email: "email" }[by], (args.sortDirection as Dir | undefined) ?? "asc")] };
    },
    filters: {
      kind: (v: string) => sql<boolean>`kind = ${v}`,
      status: (v: string) => {
        const inactive = sql<boolean>`exists(select 1 from user_statuses us where us.user_id = users.id and us.status <> 'active')`;
        return v === "active" ? sql<boolean>`not ${inactive}` : inactive;
      },
      // An address can be searched and sorted by only by those who may see it.
      query: async (v: string, args) =>
        sql<boolean>`(${contains(sql.ref("login"), v)} or ${contains(sql.ref("display_name"), v)} or ${(await isGlobalAdmin(ctx, args.actorId as string)) ? contains(sql.ref("email"), v) : sql<boolean>`1 = 0`})`,
      sortBy: async (v: string, args) => {
        if (v === "email" && !(await isGlobalAdmin(ctx, args.actorId as string))) throw new ForbiddenError("Only a global admin may sort users by email");
        return sql<boolean>`1 = 1`;
      },
    },
    // Nobody could grant the role again.
    guardChange: async (id, patch) => {
      if (patch === undefined || (patch.kind !== undefined && patch.kind !== "admin")) await assertNotLastAdmin(ctx, id);
    },
  });
  // A login names exactly one user (mentions rely on it). Checked here so the
  // caller gets a ConflictError instead of a raw unique-index failure.
  const assertLoginFree = async (login: unknown): Promise<void> => {
    if (typeof login !== "string") return;
    const row = await ctx.db
      .selectFrom("users")
      .select("id")
      .where((eb) => eb(eb.fn("lower", ["login"]), "=", login.toLowerCase()))
      .executeTakeFirst();
    if (row) throw new ConflictError(`Login "${login}" is already taken`);
  };
  const group = makeCrud(ctx, { table: "user_groups", schema: UserGroup, idArg: "groupId", entityName: "UserGroup", workspaceOnly: true, sort: byName });

  return {
    createStatus: status.create, getStatus: status.get, updateStatus: status.update, deleteStatus: status.remove, listStatuses: status.list,
    createPriority: priority.create, getPriority: priority.get, updatePriority: priority.update, deletePriority: priority.remove, listPriorities: priority.list,
    createLabel: label.create, getLabel: label.get, updateLabel: label.update, deleteLabel: label.remove, listLabels: label.list,
    createIssueType: issueType.create, getIssueType: issueType.get, updateIssueType: issueType.update, deleteIssueType: issueType.remove, listIssueTypes: issueType.list,
    createCategory: category.create, getCategory: category.get, updateCategory: category.update, deleteCategory: category.remove, listCategories: category.list,
    createRole: role.create, getRole: role.get, updateRole: role.update, deleteRole: role.remove, listRoles: role.list,
    createUser: async (args) => { await userGuard(ctx, args); await assertLoginFree(args.login); return user.create(args); },
    getUser: user.get,
    updateUser: user.update, deleteUser: user.remove, listUsers: user.list,
    createUserGroup: group.create, getUserGroup: group.get, updateUserGroup: group.update, deleteUserGroup: group.remove, listUserGroups: group.list,
  } as Pick<Behaviors, ConfigMethods>;
}
