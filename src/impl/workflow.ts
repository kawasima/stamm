import { Status, WorkflowTransition } from "../schema/index.js";
import type { Status as StatusT, WorkflowTransition as WorkflowTransitionT } from "../schema/index.js";
import type { Ctx } from "./ctx.js";
import { ConflictError, ForbiddenError } from "./errors.js";
import { makeCodec } from "./db/codec.js";

const statusCodec = makeCodec(Status);
const transitionCodec = makeCodec(WorkflowTransition, { json: ["roleIds"] });

export interface TransitionScope {
  projectId: string;
  issueTypeId: string;
  fromStatusId: string;
}

/**
 * The initial status for a new issue: the configured DefaultStatusSetting for
 * (project, type), else the first "todo" status by sortOrder. Throws if neither
 * exists (the project isn't configured enough to hold issues yet).
 */
export async function resolveDefaultStatus(ctx: Ctx, projectId: string, issueTypeId: string): Promise<StatusT> {
  const setting = await ctx.db
    .selectFrom("default_status_settings")
    .select("status_id")
    .where("project_id", "=", projectId)
    .where("issue_type_id", "=", issueTypeId)
    .executeTakeFirst();
  if (setting) {
    const row = await ctx.db.selectFrom("statuses").selectAll().where("id", "=", setting.status_id).executeTakeFirst();
    if (row) return statusCodec.decode(row);
  }
  const fallback = await ctx.db
    .selectFrom("statuses")
    .selectAll()
    .where("category", "=", "todo")
    .orderBy("sort_order")
    .orderBy("id")
    .executeTakeFirst();
  if (!fallback) throw new ConflictError("No default status configured and no 'todo' status exists");
  return statusCodec.decode(fallback);
}

/** Every transition rule defined from `scope.fromStatusId` (no role filtering). */
export async function transitionsForScope(ctx: Ctx, scope: TransitionScope): Promise<WorkflowTransitionT[]> {
  const rows = await ctx.db
    .selectFrom("workflow_transitions")
    .selectAll()
    .where("project_id", "=", scope.projectId)
    .where("issue_type_id", "=", scope.issueTypeId)
    .where("from_status_id", "=", scope.fromStatusId)
    .execute();
  return rows.map((r) => transitionCodec.decode(r));
}

/** Transitions allowed from `scope.fromStatusId` for an actor holding `actorRoleIds`. */
export async function availableTransitions(
  ctx: Ctx,
  scope: TransitionScope,
  actorRoleIds: string[],
): Promise<WorkflowTransitionT[]> {
  const all = await transitionsForScope(ctx, scope);
  // An empty roleIds means "any member"; otherwise the actor must hold one.
  return all.filter((t) => t.roleIds.length === 0 || t.roleIds.some((r) => actorRoleIds.includes(r)));
}

export async function assertTransitionAllowed(
  ctx: Ctx,
  scope: TransitionScope,
  toStatusId: string,
  actorRoleIds: string[],
): Promise<void> {
  const allowed = await availableTransitions(ctx, scope, actorRoleIds);
  if (!allowed.some((t) => t.toStatusId === toStatusId)) {
    throw new ForbiddenError(`Transition from ${scope.fromStatusId} to ${toStatusId} is not allowed`);
  }
}
