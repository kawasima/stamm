import { Notification, NotificationRead } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { buildPage, decodeCursor } from "../pagination.js";

type NotificationMethods = "listNotifications" | "getUnreadNotificationCount" | "markNotificationRead" | "markAllNotificationsRead";

export function notificationBehaviors(ctx: Ctx): Pick<Behaviors, NotificationMethods> {
  const db = ctx.db;
  const codec = makeCodec(Notification);
  const readCodec = makeCodec(NotificationRead);

  return {
    listNotifications: async ({ recipientId, projectId, eventType, isRead, pagination }) => {
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

    getUnreadNotificationCount: async ({ recipientId }) => {
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

    markNotificationRead: async ({ notificationId }) => {
      const exists = await db.selectFrom("notifications").select("id").where("id", "=", notificationId).executeTakeFirst();
      if (!exists) throw new NotFoundError("Notification", notificationId);
      const already = await db.selectFrom("notification_reads").selectAll().where("notification_id", "=", notificationId).executeTakeFirst();
      if (already) return readCodec.decode(already);
      const read = NotificationRead.parse({ id: ctx.genId(), notificationId, occurredAt: ctx.now() });
      await db.insertInto("notification_reads").values(readCodec.encode(read) as never).execute();
      return read;
    },

    markAllNotificationsRead: async ({ recipientId, projectId }) => {
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
