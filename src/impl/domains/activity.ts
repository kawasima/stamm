import { ActivityEntry } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { buildPage, decodeCursor } from "../pagination.js";

type ActivityMethods = "listActivities" | "getActivity";

/**
 * Read access to the canonical timeline (see schema/activity.ts). Entries are
 * append-only and written implicitly by every mutation via {@link appendActivity},
 * so this domain is read-only. Like {@link listIssueStatusHistory}, the contracts
 * carry no actorId: the timeline is open to read, the same way config reads are.
 *
 * The feed is chronological (newest first), so pagination is a compound keyset on
 * (occurred_at, id) rather than the plain id keyset the config lists use — id is a
 * random uuid and would order the feed meaninglessly.
 */
export function activityBehaviors(ctx: Ctx): Pick<Behaviors, ActivityMethods> {
  const db = ctx.db;
  const codec = makeCodec(ActivityEntry, { json: ["changes"] });
  const keyOf = (e: ActivityEntry): string => `${e.occurredAt}|${e.id}`;

  return {
    listActivities: async ({ projectId, userId, action, targetType, targetId, occurredAfter, occurredBefore, pagination }) => {
      const limit = pagination?.limit ?? 20;
      let q = db.selectFrom("activity_entries").selectAll();
      if (projectId) q = q.where("project_id", "=", projectId);
      if (userId) q = q.where("user_id", "=", userId);
      if (action) q = q.where("action", "=", action);
      if (targetType) q = q.where("target_type", "=", targetType);
      if (targetId) q = q.where("target_id", "=", targetId);
      if (occurredAfter) q = q.where("occurred_at", ">=", occurredAfter);
      if (occurredBefore) q = q.where("occurred_at", "<=", occurredBefore);

      const cursor = decodeCursor(pagination?.cursor);
      if (cursor) {
        const sep = cursor.indexOf("|");
        const occ = cursor.slice(0, sep);
        const id = cursor.slice(sep + 1);
        // strictly "older than" the cursor under (occurred_at desc, id desc)
        q = q.where((eb) => eb.or([eb("occurred_at", "<", occ), eb.and([eb("occurred_at", "=", occ), eb("id", "<", id)])]));
      }

      const rows = await q.orderBy("occurred_at", "desc").orderBy("id", "desc").limit(limit + 1).execute();
      const page = buildPage(rows.map((r) => codec.decode(r)), keyOf, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    getActivity: async ({ activityId }) => {
      const row = await db.selectFrom("activity_entries").selectAll().where("id", "=", activityId).executeTakeFirst();
      if (!row) throw new NotFoundError("ActivityEntry", activityId);
      return codec.decode(row);
    },
  };
}
