import { ActivityEntry } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { assertCanReadIssue, assertCanReadProject, canReadProject, isGlobalAdmin } from "../permissions.js";
import { makeCodec } from "../db/codec.js";
import { buildPage, decodeCursor } from "../pagination.js";

type ActivityMethods = "listActivities" | "getActivity";

/**
 * Read access to the canonical timeline (see schema/activity.ts). Entries are
 * append-only and written implicitly by every mutation via {@link appendActivity},
 * so this domain is read-only.
 *
 * Read scoping mirrors the rest of the system: an entry is visible only if the
 * actor can read its project (global admin, member, or a non-private project),
 * and an entry about an issue only if the actor can read that issue (private
 * issues, `own_or_assigned` roles). Entries about a since-deleted issue are
 * visible to global admins only, like the rest of the preserved history.
 *
 * The feed is chronological (newest first), so pagination is a compound keyset on
 * (occurred_at, id) rather than the plain id keyset the config lists use — id is a
 * random uuid and would order the feed meaninglessly.
 */
export function activityBehaviors(ctx: Ctx): Pick<Behaviors, ActivityMethods> {
  const db = ctx.db;
  const codec = makeCodec(ActivityEntry, { json: ["changes"] });
  const keyOf = (e: ActivityEntry): string => `${e.occurredAt}|${e.id}`;

  /** Whether `actorId` may see one entry. Project scoping for lists is done in SQL; this is the per-entry check. */
  const canSeeEntry = async (actorId: string, e: ActivityEntry, issueMemo: Map<string, boolean>): Promise<boolean> => {
    if (!(await canReadProject(ctx, e.projectId, actorId))) return false;
    if (e.targetType !== "issue") return true;
    let ok = issueMemo.get(e.targetId);
    if (ok === undefined) {
      try {
        await assertCanReadIssue(ctx, e.targetId, actorId);
        ok = true;
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
        ok = false;
      }
      issueMemo.set(e.targetId, ok);
    }
    return ok;
  };

  return {
    listActivities: async ({ actorId, projectId, userId, action, targetType, targetId, occurredAfter, occurredBefore, pagination }) => {
      const limit = pagination?.limit ?? 20;
      const isAdmin = await isGlobalAdmin(ctx, actorId);
      if (!isAdmin && projectId) await assertCanReadProject(ctx, projectId, actorId);

      const fetchAfter = async (cursorKey: string | undefined, batch: number) => {
        let q = db.selectFrom("activity_entries").selectAll();
        if (projectId) q = q.where("project_id", "=", projectId);
        if (userId) q = q.where("user_id", "=", userId);
        if (action) q = q.where("action", "=", action);
        if (targetType) q = q.where("target_type", "=", targetType);
        if (targetId) q = q.where("target_id", "=", targetId);
        if (occurredAfter) q = q.where("occurred_at", ">=", occurredAfter);
        if (occurredBefore) q = q.where("occurred_at", "<=", occurredBefore);
        if (!isAdmin) {
          // Project-level scoping, same rule as canReadProject: member, or not private.
          q = q.where((eb) =>
            eb.or([
              eb("project_id", "in", eb.selectFrom("project_memberships").select("project_id").where("user_id", "=", actorId)),
              eb("project_id", "not in", eb.selectFrom("project_categories").select("project_id").where("visibility", "=", "private")),
            ]),
          );
        }
        if (cursorKey) {
          const sep = cursorKey.indexOf("|");
          const occ = cursorKey.slice(0, sep);
          const id = cursorKey.slice(sep + 1);
          // strictly "older than" the cursor under (occurred_at desc, id desc)
          q = q.where((eb) => eb.or([eb("occurred_at", "<", occ), eb.and([eb("occurred_at", "=", occ), eb("id", "<", id)])]));
        }
        return q.orderBy("occurred_at", "desc").orderBy("id", "desc").limit(batch).execute();
      };

      // Issue-level visibility can't be expressed in the SQL above, so filter per
      // entry and keep reading until a full page (+1 for the cursor) is collected.
      const batch = Math.max(limit + 1, 50);
      const issueMemo = new Map<string, boolean>();
      const visible: ActivityEntry[] = [];
      let cursorKey = decodeCursor(pagination?.cursor);
      for (;;) {
        const rows = await fetchAfter(cursorKey, batch);
        for (const r of rows) {
          const entry = codec.decode(r);
          if (isAdmin || (await canSeeEntry(actorId, entry, issueMemo))) visible.push(entry);
          if (visible.length === limit + 1) break;
        }
        if (visible.length === limit + 1 || rows.length < batch) break;
        cursorKey = keyOf(codec.decode(rows[rows.length - 1]));
      }
      const page = buildPage(visible, keyOf, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    getActivity: async ({ actorId, activityId }) => {
      const row = await db.selectFrom("activity_entries").selectAll().where("id", "=", activityId).executeTakeFirst();
      if (!row) throw new NotFoundError("ActivityEntry", activityId);
      const entry = codec.decode(row);
      // NotFound (not Forbidden) for a hidden entry so its existence can't be probed.
      if (!(await isGlobalAdmin(ctx, actorId)) && !(await canSeeEntry(actorId, entry, new Map()))) {
        throw new NotFoundError("ActivityEntry", activityId);
      }
      return entry;
    },
  };
}
