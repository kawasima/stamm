import { sql } from "kysely";
import { ActivityEntry } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { assertCanReadProject, isGlobalAdmin } from "../permissions.js";
import { issueEventsVisible } from "../issue-visibility.js";
import { makeCodec } from "../db/codec.js";
import { listPage, onOrAfter, onOrBefore } from "../listing.js";

type ActivityMethods = "listActivities" | "getActivity";

/**
 * Read access to the canonical timeline (see schema/activity.ts). Entries are
 * append-only and written implicitly by every mutation via {@link appendActivity},
 * so this domain is read-only.
 *
 * Read scoping mirrors the rest of the system: an entry is visible only if the
 * actor can read its project (global admin, member, or a non-private project),
 * and an entry about an issue only if the actor can read that issue (private
 * issues, `own_or_assigned` roles). Entries about a since-deleted issue follow the
 * rule for its other Events (see issue-visibility.ts).
 *
 * The feed is chronological (newest first), so pagination is a compound keyset on
 * (occurred_at, id) rather than the plain id keyset the config lists use — id is a
 * random uuid and would order the feed meaninglessly.
 */
export function activityBehaviors(ctx: Ctx): Pick<Behaviors, ActivityMethods> {
  const db = ctx.db;
  const codec = makeCodec(ActivityEntry);

  /** SQL condition on a row of `activity_entries`: may `actorId` read it? */
  const entryVisible = async (actorId: string) => {
    const ids = ctx.scope?.projectIds;
    const inScope = ids === undefined ? sql<boolean>`1 = 1` : ids.length > 0 ? sql<boolean>`project_id in (${sql.join(ids)})` : sql<boolean>`1 = 0`;
    if (await isGlobalAdmin(ctx, actorId)) return inScope;
    const events = await issueEventsVisible(ctx, actorId, sql.ref("activity_entries.target_id"));
    // Project-level rule, same as canReadProject: member, or public.
    return sql<boolean>`(${inScope}
      and (
        exists(select 1 from project_memberships m where m.project_id = activity_entries.project_id and m.user_id = ${actorId})
        or exists(select 1 from project_categories c where c.project_id = activity_entries.project_id and c.visibility = 'public'))
      and (target_type <> 'issue' or ${events}))`;
  };

  return {
    listActivities: async ({ actorId, projectId, userId, action, targetType, targetId, occurredAfter, occurredBefore, pagination }) => {
      if (projectId && !(await isGlobalAdmin(ctx, actorId))) await assertCanReadProject(ctx, projectId, actorId);
      let q = db.selectFrom("activity_entries").selectAll().where(await entryVisible(actorId));
      if (projectId) q = q.where("project_id", "=", projectId);
      if (userId) q = q.where("user_id", "=", userId);
      if (action) q = q.where("action", "=", action);
      if (targetType) q = q.where("target_type", "=", targetType);
      if (targetId) q = q.where("target_id", "=", targetId);
      if (occurredAfter) q = q.where(onOrAfter(sql.ref("occurred_at"), occurredAfter));
      if (occurredBefore) q = q.where(onOrBefore(sql.ref("occurred_at"), occurredBefore));
      const page = await listPage(q, { name: "activity", keys: [{ by: sql.ref("occurred_at"), dir: "desc" }] }, "id", pagination);
      return { items: page.items.map((r) => codec.decode(r)), nextCursor: page.nextCursor };
    },

    getActivity: async ({ actorId, activityId }) => {
      // NotFound (not Forbidden) for a hidden entry so its existence can't be probed.
      const row = await db.selectFrom("activity_entries").selectAll().where("id", "=", activityId).where(await entryVisible(actorId)).executeTakeFirst();
      if (!row) throw new NotFoundError("ActivityEntry", activityId);
      return codec.decode(row);
    },
  };
}
