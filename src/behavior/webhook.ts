import { z } from "zod";
import { Id, PaginationParams, UrlString } from "../schema/common.js";
import {
  Webhook,
  WebhookStatus,
  NotificationEventType,
} from "../schema/notification.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Webhook CRUD
// ============================================================

/** Create a webhook */
export const CreateWebhook = z.function()
  .args(z.object({
    projectId: Id,
    url: UrlString,
    secret: z.string().optional(),
    events: z.array(NotificationEventType).min(1),
  }))
  .returns(z.promise(Webhook));

/** Get a webhook by ID */
export const GetWebhook = z.function()
  .args(z.object({ webhookId: Id }))
  .returns(z.promise(Webhook));

/** Update a webhook */
export const UpdateWebhook = z.function()
  .args(z.object({
    webhookId: Id,
    url: UrlString.optional(),
    secret: z.string().optional(),
    events: z.array(NotificationEventType).min(1).optional(),
    status: WebhookStatus.optional(),
  }))
  .returns(z.promise(Webhook));

/** Delete a webhook */
export const DeleteWebhook = z.function()
  .args(z.object({ webhookId: Id }))
  .returns(z.promise(z.void()));

/** List webhooks for a project */
export const ListWebhooks = z.function()
  .args(z.object({
    projectId: Id,
    status: WebhookStatus.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Webhook)));

/** Test-fire a webhook (sends a test payload) */
export const TestWebhook = z.function()
  .args(z.object({ webhookId: Id }))
  .returns(z.promise(z.object({
    success: z.boolean(),
    statusCode: z.number().int().optional(),
    responseBody: z.string().optional(),
  })));
