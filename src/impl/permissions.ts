import { Role, type Permission, type User, type PublicUser } from "../schema/index.js";
import type { Ctx } from "./ctx.js";
import { ForbiddenError, NotFoundError } from "./errors.js";
import { makeCodec } from "./db/codec.js";

const roleCodec = makeCodec(Role, { json: ["permissions"] });

export async function isGlobalAdmin(ctx: Ctx, userId: string): Promise<boolean> {
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

/**
 * Read scoping for a whole project. Global admins and members always read;
 * everyone else reads only when the project is public (its visibility is not
 * `private`). Used to gate project-scoped reads (milestones, time entries,
 * drafts, views, …) the way issues are already scoped.
 */
export async function canReadProject(ctx: Ctx, projectId: string, userId: string): Promise<boolean> {
  if (await isGlobalAdmin(ctx, userId)) return true;
  if (await isMember(ctx, projectId, userId)) return true;
  const cat = await ctx.db
    .selectFrom("project_categories")
    .select("visibility")
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  return cat?.visibility !== "private";
}

/** Gate a project-scoped read. Throws NotFound (not Forbidden) so a hidden
 *  project's existence can't be probed. */
export async function assertCanReadProject(ctx: Ctx, projectId: string, userId: string): Promise<void> {
  if (!(await canReadProject(ctx, projectId, userId))) {
    throw new NotFoundError("Project", projectId);
  }
}

/**
 * Read scoping for a single issue and everything that hangs off it (comments,
 * attachments, history, watchers, relations, children). Mirrors the policy in
 * `issue.ts` `canSeeIssue`: global admins see all; a private project or private
 * issue is hidden from non-members (the author always sees their own); a member
 * whose roles are all `own_or_assigned` sees only issues they authored or are
 * assigned to. Throws NotFound when the issue does not exist or is not visible,
 * so a non-member cannot tell the two apart.
 */
export async function assertCanReadIssue(ctx: Ctx, issueId: string, userId: string): Promise<void> {
  // Global admins are unrestricted, and may still audit the preserved history of
  // a since-deleted issue — so check admin before the existence check.
  if (await isGlobalAdmin(ctx, userId)) return;
  const issue = await ctx.db
    .selectFrom("issues")
    .select(["id", "project_id", "author_id", "visibility"])
    .where("id", "=", issueId)
    .executeTakeFirst();
  if (!issue) throw new NotFoundError("Issue", issueId);

  const author = issue.author_id === userId;
  const member = await isMember(ctx, issue.project_id, userId);
  const cat = await ctx.db
    .selectFrom("project_categories")
    .select("visibility")
    .where("project_id", "=", issue.project_id)
    .executeTakeFirst();
  if (cat?.visibility === "private" && !member && !author) throw new NotFoundError("Issue", issueId);
  if (issue.visibility === "private" && !member && !author) throw new NotFoundError("Issue", issueId);

  if (member && !author) {
    const roles = await rolesOf(ctx, issue.project_id, userId);
    const restricted = roles.length > 0 && roles.every((r) => r.issuesVisibility === "own_or_assigned");
    if (restricted) {
      const assigned = await ctx.db
        .selectFrom("issue_assignees")
        .select("id")
        .where("issue_id", "=", issueId)
        .where("assignee_id", "=", userId)
        .executeTakeFirst();
      if (!assigned) throw new NotFoundError("Issue", issueId);
    }
  }
}
