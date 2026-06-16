import { z } from "zod";
import { Id, PaginationParams } from "../schema/common.js";
import {
  Notification,
  NotificationRead,
  NotificationEventType,
} from "../schema/notification.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Notifications
// ============================================================

/** List notifications for a user */
export const ListNotifications = z.function()
  .args(z.object({
    recipientId: Id,
    projectId: Id.optional(),
    eventType: NotificationEventType.optional(),
    isRead: z.boolean().optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Notification)));

/** Get unread notification count for a user */
export const GetUnreadNotificationCount = z.function()
  .args(z.object({ recipientId: Id }))
  .returns(z.promise(z.object({
    count: z.number().int(),
  })));

/** Mark a notification as read */
export const MarkNotificationRead = z.function()
  .args(z.object({ actorId: Id, notificationId: Id }))
  .returns(z.promise(NotificationRead));

/** Mark all notifications as read for a user */
export const MarkAllNotificationsRead = z.function()
  .args(z.object({
    actorId: Id,
    recipientId: Id,
    projectId: Id.optional(),
  }))
  .returns(z.promise(z.object({
    markedCount: z.number().int(),
  })));
