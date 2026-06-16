import { Role, type Permission } from "../schema/index.js";
import type { Ctx } from "./ctx.js";
import { ForbiddenError } from "./errors.js";
import { makeCodec } from "./db/codec.js";

const roleCodec = makeCodec(Role, { json: ["permissions"] });

export async function isGlobalAdmin(ctx: Ctx, userId: string): Promise<boolean> {
  const row = await ctx.db.selectFrom("users").select("kind").where("id", "=", userId).executeTakeFirst();
  return row?.kind === "admin";
}

export async function isMember(ctx: Ctx, projectId: string, userId: string): Promise<boolean> {
  const row = await ctx.db
    .selectFrom("project_memberships")
    .select("id")
    .where("project_id", "=", projectId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row !== undefined;
}

/** The roles a user holds in a project (via the normalized membership-role join). */
export async function rolesOf(ctx: Ctx, projectId: string, userId: string): Promise<Role[]> {
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
  if (!(await isGlobalAdmin(ctx, userId))) {
    throw new ForbiddenError(`User ${userId} must be a global admin for this operation`);
  }
}
