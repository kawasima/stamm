import { sql } from "kysely";
import { Notification, NotificationRead } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { listPage } from "../listing.js";
import { isGlobalAdmin, scopeAllowsProject } from "../permissions.js";

type NotificationMethods = "listNotifications" | "getUnreadNotificationCount" | "markNotificationRead" | "markAllNotificationsRead";

export function notificationBehaviors(ctx: Ctx): Pick<Behaviors, NotificationMethods> {
  const db = ctx.db;
  const codec = makeCodec(Notification);
  const readCodec = makeCodec(NotificationRead);

  /** A notification inbox is private: only its recipient (or a global admin) may
   *  read or mutate it. Prevents an authenticated user from reading someone
   *  else's notifications by passing another recipientId. */
  const assertOwnInbox = async (actorId: string, recipientId: string): Promise<void> => {
    if (actorId === recipientId) return;
    if (await isGlobalAdmin(ctx, actorId)) return;
    throw new ForbiddenError(`User ${actorId} may not access notifications for ${recipientId}`);
  };

  return {
    listNotifications: async ({ actorId, recipientId: target, projectId, eventType, isRead, pagination }) => {
      const recipientId = target ?? actorId;
      await assertOwnInbox(actorId, recipientId);
      let q = db.selectFrom("notifications").selectAll().where("recipient_id", "=", recipientId);
      if (ctx.scope?.projectIds) q = q.where("project_id", "in", ctx.scope.projectIds);
      if (projectId) q = q.where("project_id", "=", projectId);
      if (eventType) q = q.where("event_type", "=", eventType);
      if (isRead !== undefined) {
        q = q.where(({ exists, not, selectFrom }) => {
          const hasRead = exists(selectFrom("notification_reads").select("id").whereRef("notification_reads.notification_id", "=", "notifications.id"));
          return isRead ? hasRead : not(hasRead);
        });
      }
      const page = await listPage(q, { name: "notifications", keys: [{ by: sql.ref("occurred_at"), dir: "desc" }] }, "id", pagination);
      return { items: page.items.map((r) => codec.decode(r)), nextCursor: page.nextCursor };
    },

    getUnreadNotificationCount: async ({ actorId, recipientId: target }) => {
      const recipientId = target ?? actorId;
      await assertOwnInbox(actorId, recipientId);
      let counted = db
        .selectFrom("notifications")
        .select((eb) => eb.fn.countAll().as("cnt"))
        .where("recipient_id", "=", recipientId);
      if (ctx.scope?.projectIds) counted = counted.where("project_id", "in", ctx.scope.projectIds);
      const row = await counted
        .where(({ exists, not, selectFrom }) =>
          not(exists(selectFrom("notification_reads").select("id").whereRef("notification_reads.notification_id", "=", "notifications.id"))),
        )
        .executeTakeFirst();
      return { count: Number(row?.cnt ?? 0) };
    },

    markNotificationRead: async ({ actorId, notificationId }) => {
      const exists = await db.selectFrom("notifications").select(["id", "recipient_id", "project_id"]).where("id", "=", notificationId).executeTakeFirst();
      // A project-limited key does not see notifications of other projects at all.
      if (!exists || !scopeAllowsProject(ctx, exists.project_id)) throw new NotFoundError("Notification", notificationId);
      await assertOwnInbox(actorId, exists.recipient_id);
      const already = await db.selectFrom("notification_reads").selectAll().where("notification_id", "=", notificationId).executeTakeFirst();
      if (already) return readCodec.decode(already);
      const read = NotificationRead.parse({ id: ctx.genId(), notificationId, occurredAt: ctx.now() });
      await db.insertInto("notification_reads").values(readCodec.encode(read) as never).execute();
      return read;
    },

    markAllNotificationsRead: async ({ actorId, recipientId: target, projectId }) => {
      const recipientId = target ?? actorId;
      await assertOwnInbox(actorId, recipientId);
      let q = db
        .selectFrom("notifications")
        .select("id")
        .where("recipient_id", "=", recipientId)
        .where(({ exists, not, selectFrom }) =>
          not(exists(selectFrom("notification_reads").select("id").whereRef("notification_reads.notification_id", "=", "notifications.id"))),
        );
      if (ctx.scope?.projectIds) q = q.where("project_id", "in", ctx.scope.projectIds);
      if (projectId) q = q.where("project_id", "=", projectId);
      const unread = await q.execute();
      if (unread.length === 0) return { markedCount: 0 };
      const occurredAt = ctx.now();
      // One multi-row insert rather than a statement per unread notification.
      const rows = unread.map((n) => ({ id: ctx.genId(), notification_id: n.id, occurred_at: occurredAt }));
      await db.insertInto("notification_reads").values(rows).execute();
      return { markedCount: unread.length };
    },
  };
}
