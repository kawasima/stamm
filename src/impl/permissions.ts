import { Role, type Permission, type User, type PublicUser } from "../schema/index.js";
import type { Ctx } from "./ctx.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import { makeCodec } from "./db/codec.js";

const roleCodec = makeCodec(Role, { json: ["permissions"] });

/**
 * Whether the key behind `ctx` may touch `projectId`. Always true for an
 * unscoped ctx. A scope can only narrow access: callers still apply the user's
 * own rights on top.
 */
export function scopeAllowsProject(ctx: Ctx, projectId: string): boolean {
  const ids = ctx.scope?.projectIds;
  return ids === undefined || ids.includes(projectId);
}

export async function isGlobalAdmin(ctx: Ctx, userId: string): Promise<boolean> {
  // A project-limited key never acts as a global admin: the admin bypass would
  // reach every project, which is exactly what the scope is there to prevent.
  if (ctx.scope?.projectIds) return false;
  const row = await ctx.db.selectFrom("users").select("kind").where("id", "=", userId).executeTakeFirst();
  return row?.kind === "admin";
}

/**
 * Drop `email` from a user row unless the viewer is allowed to see it. A viewer
 * may see an address only when they are a global admin or it is their own row;
 * everyone else (including an absent/unknown viewer) gets the public projection.
 * `viewerIsAdmin` is resolved once by the caller so a list doesn't re-query per
 * row. `kind` is deliberately kept — see {@link PublicUser}.
 */
export function projectUser(user: User, viewerId: string | undefined, viewerIsAdmin: boolean): PublicUser {
  if (viewerIsAdmin || (viewerId !== undefined && viewerId === user.id)) return user;
  const { email: _email, ...rest } = user;
  return rest;
}

export async function isMember(ctx: Ctx, projectId: string, userId: string): Promise<boolean> {
  if (!scopeAllowsProject(ctx, projectId)) return false;
  const row = await ctx.db
    .selectFrom("project_memberships")
    .select("id")
    .where("project_id", "=", projectId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Assignees must belong to the issue's project. Assigning an outsider would hand
 * them a notification carrying the issue's title, which for a private project
 * discloses it to someone who may not read it.
 */
export async function assertAssignable(ctx: Ctx, projectId: string, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const rows = await ctx.db
    .selectFrom("project_memberships")
    .select("user_id")
    .where("project_id", "=", projectId)
    .where("user_id", "in", ids)
    .execute();
  const members = new Set(rows.map((r) => r.user_id));
  const outsiders = ids.filter((id) => !members.has(id));
  if (outsiders.length) {
    throw new ValidationError(`Not members of project ${projectId}, so they cannot be assigned: ${outsiders.join(", ")}`);
  }
}

/**
 * Whether a viewer may see members-only ("private") content in a project:
 * global admins and project members. Used to gate private comments, which are
 * otherwise readable by any non-member who can see a public project's issue.
 */
export async function canSeePrivateInProject(ctx: Ctx, projectId: string, userId: string): Promise<boolean> {
  if (await isGlobalAdmin(ctx, userId)) return true;
  return isMember(ctx, projectId, userId);
}

/** The roles a user holds in a project (via the normalized membership-role join). */
export async function rolesOf(ctx: Ctx, projectId: string, userId: string): Promise<Role[]> {
  if (!scopeAllowsProject(ctx, projectId)) return [];
  const rows = await ctx.db
    .selectFrom("project_memberships as m")
    .innerJoin("project_membership_roles as mr", "mr.membership_id", "m.id")
    .innerJoin("roles as r", "r.id", "mr.role_id")
    .selectAll("r")
    .where("m.project_id", "=", projectId)
    .where("m.user_id", "=", userId)
    .execute();
  return rows.map((r) => roleCodec.decode(r));
}

export async function roleIdsOf(ctx: Ctx, projectId: string, userId: string): Promise<string[]> {
  if (!scopeAllowsProject(ctx, projectId)) return [];
  const rows = await ctx.db
    .selectFrom("project_memberships as m")
    .innerJoin("project_membership_roles as mr", "mr.membership_id", "m.id")
    .select("mr.role_id as roleId")
    .where("m.project_id", "=", projectId)
    .where("m.user_id", "=", userId)
    .execute();
  return rows.map((r) => r.roleId);
}

export async function hasPermission(ctx: Ctx, projectId: string, userId: string, perm: Permission): Promise<boolean> {
  // A read-only key holds no write permission, whatever its user's roles are.
  if (ctx.scope?.readOnly) return false;
  if (!scopeAllowsProject(ctx, projectId)) return false;
  if (await isGlobalAdmin(ctx, userId)) return true;
  const roles = await rolesOf(ctx, projectId, userId);
  return roles.some((r) => r.permissions.includes(perm));
}

/** Gate a project-scoped write. Global admins bypass; otherwise a role must grant `perm`. */
export async function assertCanWrite(ctx: Ctx, projectId: string, userId: string, perm: Permission): Promise<void> {
  if (!(await hasPermission(ctx, projectId, userId, perm))) {
    throw new ForbiddenError(`User ${userId} lacks permission '${perm}' in project ${projectId}`);
  }
}

/** Gate a global (project-less) write such as config CRUD or project creation. */
export async function assertGlobalAdmin(ctx: Ctx, userId: string): Promise<void> {
  if (ctx.scope?.readOnly || !(await isGlobalAdmin(ctx, userId))) {
    throw new ForbiddenError(`User ${userId} must be a global admin for this operation`);
  }
}

/**
 * Read scoping for a whole project. Global admins and members always read;
 * everyone else reads only when the project is public. One without a visibility, or
 * one that does not exist, is not. Used to gate project-scoped reads (milestones, time entries,
 * drafts, views, …) the way issues are already scoped.
 */
export async function canReadProject(ctx: Ctx, projectId: string, userId: string): Promise<boolean> {
  if (!scopeAllowsProject(ctx, projectId)) return false;
  if (await isGlobalAdmin(ctx, userId)) return true;
  if (await isMember(ctx, projectId, userId)) return true;
  const cat = await ctx.db
    .selectFrom("project_categories")
    .select("visibility")
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  return cat?.visibility === "public";
}

/** Gate a project-scoped read. Throws NotFound (not Forbidden) so a hidden
 *  project's existence can't be probed. */
export async function assertCanReadProject(ctx: Ctx, projectId: string, userId: string): Promise<void> {
  if (!(await canReadProject(ctx, projectId, userId))) {
    throw new NotFoundError("Project", projectId);
  }
}

/** Refuse what would leave the workspace without an active global admin. */
export async function assertNotLastAdmin(ctx: Ctx, userId: string): Promise<void> {
  const active = await ctx.db
    .selectFrom("users")
    .select("id")
    .where("kind", "=", "admin")
    .where((eb) => eb.not(eb.exists(eb.selectFrom("user_statuses").select("id").whereRef("user_statuses.user_id", "=", "users.id").where("status", "<>", "active"))))
    .execute();
  if (active.length === 1 && active[0]!.id === userId) throw new ConflictError("This is the last active admin");
}
