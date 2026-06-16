import { z } from "zod";
import { Id, Resource, TargetRef, Timestamp, UrlString } from "./common.js";

export const NotificationEventType = z.enum([
  "issue.created",
  "issue.updated",
  "issue.status_changed",
  "issue.assigned",
  "issue.commented",
  "issue.closed",
  "issue.iteration_set",
  "milestone.created",
  "milestone.closed",
  "iteration.started",
  "iteration.closed",
  "wiki.updated",
]);

/** Notification delivery (E) */
export const Notification = z.object({
  id: Id,
  recipientId: Id,
  eventType: NotificationEventType,
  projectId: Id,
  title: z.string().max(500),
  occurredAt: Timestamp,
}).merge(TargetRef);

/** Notification read (E) - reading is a separate event */
export const NotificationRead = z.object({
  id: Id,
  notificationId: Id,
  occurredAt: Timestamp,
});

export const WebhookStatus = z.enum(["active", "inactive"]);

/** Webhook (R) */
export const Webhook = Resource.extend({
  projectId: Id,
  url: UrlString,
  secret: z.string().optional(),
  events: z.array(NotificationEventType).min(1),
  status: WebhookStatus.default("active"),
});

export type NotificationEventType = z.infer<typeof NotificationEventType>;
export type Notification = z.infer<typeof Notification>;
export type NotificationRead = z.infer<typeof NotificationRead>;
export type WebhookStatus = z.infer<typeof WebhookStatus>;
export type Webhook = z.infer<typeof Webhook>;
