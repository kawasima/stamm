import { sql, type RawBuilder } from "kysely";
import type { Ctx } from "./ctx.js";
import { NotFoundError } from "./errors.js";
import { isGlobalAdmin } from "./permissions.js";

/**
 * Who can read which issue, in one place. Everything that returns an issue, or
 * something hanging off one, goes through these; a second statement of the policy
 * would sooner or later say something else.
 *
 * The policy: a project-limited key sees only its projects. Within that, a global
 * admin sees every issue. Anyone else sees an issue they wrote; otherwise they
 * must be a member of its project, or both the project and the issue must be
 * public. A member whose roles are all `own_or_assigned` sees only what they
 * wrote or are assigned to. Public means said to be public: a project without a
 * visibility is not.
 */

/** Limit `projectId` to the key's projects. `true` for an unscoped ctx. */
const inScope = (ctx: Ctx, projectId: RawBuilder<unknown>): RawBuilder<boolean> => {
  const ids = ctx.scope?.projectIds;
  if (ids === undefined) return sql<boolean>`1 = 1`;
  return ids.length > 0 ? sql<boolean>`${projectId} in (${sql.join(ids)})` : sql<boolean>`1 = 0`;
};

/** A member with a role that sees every issue of the project. */
const seesWholeProject = (projectId: RawBuilder<unknown>, userId: string): RawBuilder<boolean> => sql<boolean>`exists(
  select 1 from project_memberships pm
  join project_membership_roles mr on mr.membership_id = pm.id
  join roles r on r.id = mr.role_id
  where pm.project_id = ${projectId} and pm.user_id = ${userId} and r.issues_visibility = 'all')`;

/** SQL condition on a row of `issues`, under the alias `table`: may `actorId` read it? */
export async function issueVisible(ctx: Ctx, actorId: string, table = "issues"): Promise<RawBuilder<boolean>> {
  const col = (name: string) => sql.ref(`${table}.${name}`);
  const scoped = inScope(ctx, col("project_id"));
  if (await isGlobalAdmin(ctx, actorId)) return scoped;
  return sql<boolean>`(${scoped} and (
    ${col("author_id")} = ${actorId}
    or ${seesWholeProject(col("project_id"), actorId)}
    or exists(
      select 1 from project_memberships pm join issue_assignees ia on ia.assignee_id = pm.user_id
      where pm.project_id = ${col("project_id")} and pm.user_id = ${actorId} and ia.issue_id = ${col("id")})
    or (
      ${col("visibility")} = 'public'
      and not exists(select 1 from project_memberships pm where pm.project_id = ${col("project_id")} and pm.user_id = ${actorId})
      and exists(select 1 from project_categories pc where pc.project_id = ${col("project_id")} and pc.visibility = 'public'))))`;
}

/**
 * SQL condition on a column holding an issue id: may `actorId` read that issue's
 * Events? Events outlive the issue, so a deleted one is judged by the project it
 * was deleted from: a global admin, or a member who sees every issue there. They
 * could have read it while it existed, so nothing is disclosed by its deletion.
 */
export async function issueEventsVisible(ctx: Ctx, actorId: string, issueId: RawBuilder<unknown>): Promise<RawBuilder<boolean>> {
  const admin = await isGlobalAdmin(ctx, actorId);
  const live = await issueVisible(ctx, actorId, "vi");
  const project = sql.ref("del.project_id");
  const deleted = sql<boolean>`${inScope(ctx, project)} and ${admin ? sql<boolean>`1 = 1` : seesWholeProject(project, actorId)}`;
  return sql<boolean>`(
    exists(select 1 from issues vi where vi.id = ${issueId} and ${live})
    or (
      not exists(select 1 from issues vi where vi.id = ${issueId})
      and exists(
        select 1 from activity_entries del
        where del.target_type = 'issue' and del.target_id = ${issueId} and del.action = 'deleted' and ${deleted})))`;
}

/**
 * SQL condition on a column holding an issue id: does it belong to `projectId`?
 * An issue's history follows it when it moves, so a live issue belongs to its
 * current project, as in a search; a deleted one to the project it was deleted from.
 */
export const issueInProject = (issueId: RawBuilder<unknown>, projectId: string): RawBuilder<boolean> => sql<boolean>`(
  exists(select 1 from issues pi where pi.id = ${issueId} and pi.project_id = ${projectId})
  or (
    not exists(select 1 from issues pi where pi.id = ${issueId})
    and exists(
      select 1 from activity_entries del
      where del.target_type = 'issue' and del.target_id = ${issueId} and del.action = 'deleted' and del.project_id = ${projectId})))`;

export async function canReadIssue(ctx: Ctx, issueId: string, actorId: string): Promise<boolean> {
  const visible = await issueVisible(ctx, actorId);
  return (await ctx.db.selectFrom("issues").select("id").where("id", "=", issueId).where(visible).executeTakeFirst()) !== undefined;
}

/** Gate a read of an issue or its current state. Absent and hidden look the same. */
export async function assertCanReadIssue(ctx: Ctx, issueId: string, actorId: string): Promise<void> {
  if (!(await canReadIssue(ctx, issueId, actorId))) throw new NotFoundError("Issue", issueId);
}

/** Gate a read of an issue's Events, which includes a deleted issue's. */
export async function assertCanReadIssueEvents(ctx: Ctx, issueId: string, actorId: string): Promise<void> {
  const visible = await issueEventsVisible(ctx, actorId, sql`${issueId}`);
  const row = await sql<{ ok: number }>`select 1 as ok where ${visible}`.execute(ctx.db);
  if (row.rows.length === 0) throw new NotFoundError("Issue", issueId);
}

/** Which of `issueIds` the actor can read. */
export async function readableIssueIds(ctx: Ctx, actorId: string, issueIds: string[]): Promise<Set<string>> {
  if (issueIds.length === 0) return new Set();
  const visible = await issueVisible(ctx, actorId);
  const rows = await ctx.db.selectFrom("issues").select("id").where("id", "in", issueIds).where(visible).execute();
  return new Set(rows.map((r) => r.id));
}
