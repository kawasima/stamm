import { Notification, NotificationRead } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { buildPage, decodeCursor } from "../pagination.js";
import { isGlobalAdmin } from "../permissions.js";

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
    listNotifications: async ({ actorId, recipientId, projectId, eventType, isRead, pagination }) => {
      await assertOwnInbox(actorId, recipientId);
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("notifications").selectAll().where("recipient_id", "=", recipientId);
      if (projectId) q = q.where("project_id", "=", projectId);
      if (eventType) q = q.where("event_type", "=", eventType);
      if (isRead !== undefined) {
        q = q.where(({ exists, not, selectFrom }) => {
          const hasRead = exists(selectFrom("notification_reads").select("id").whereRef("notification_reads.notification_id", "=", "notifications.id"));
          return isRead ? hasRead : not(hasRead);
        });
      }
      if (cursor) q = q.where("id", ">", cursor);
      const rows = await q.orderBy("id").limit(limit + 1).execute();
      const page = buildPage(rows.map((r) => codec.decode(r)), (n) => n.id, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    getUnreadNotificationCount: async ({ actorId, recipientId }) => {
      await assertOwnInbox(actorId, recipientId);
      const row = await db
        .selectFrom("notifications")
        .select((eb) => eb.fn.countAll().as("cnt"))
        .where("recipient_id", "=", recipientId)
        .where(({ exists, not, selectFrom }) =>
          not(exists(selectFrom("notification_reads").select("id").whereRef("notification_reads.notification_id", "=", "notifications.id"))),
        )
        .executeTakeFirst();
      return { count: Number(row?.cnt ?? 0) };
    },

    markNotificationRead: async ({ actorId, notificationId }) => {
      const exists = await db.selectFrom("notifications").select(["id", "recipient_id"]).where("id", "=", notificationId).executeTakeFirst();
      if (!exists) throw new NotFoundError("Notification", notificationId);
      await assertOwnInbox(actorId, exists.recipient_id);
      const already = await db.selectFrom("notification_reads").selectAll().where("notification_id", "=", notificationId).executeTakeFirst();
      if (already) return readCodec.decode(already);
      const read = NotificationRead.parse({ id: ctx.genId(), notificationId, occurredAt: ctx.now() });
      await db.insertInto("notification_reads").values(readCodec.encode(read) as never).execute();
      return read;
    },

    markAllNotificationsRead: async ({ actorId, recipientId, projectId }) => {
      await assertOwnInbox(actorId, recipientId);
      let q = db
        .selectFrom("notifications")
        .select("id")
        .where("recipient_id", "=", recipientId)
        .where(({ exists, not, selectFrom }) =>
          not(exists(selectFrom("notification_reads").select("id").whereRef("notification_reads.notification_id", "=", "notifications.id"))),
        );
      if (projectId) q = q.where("project_id", "=", projectId);
      const unread = await q.execute();
      const occurredAt = ctx.now();
      await db.transaction().execute(async (trx) => {
        for (const n of unread) {
          await trx.insertInto("notification_reads").values({ id: ctx.genId(), notification_id: n.id, occurred_at: occurredAt }).execute();
        }
      });
      return { markedCount: unread.length };
    },
  };
}
