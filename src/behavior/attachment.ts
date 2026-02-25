import { z } from "zod";
import { Id, PaginationParams } from "../schema/common.js";
import { Attachment } from "../schema/attachment.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Attachment CRUD
// ============================================================

/** Create an attachment (upload metadata — actual file storage is implementation concern) */
export const CreateAttachment = z.function()
  .args(z.object({
    targetType: z.string().min(1),
    targetId: Id,
    authorId: Id,
    filename: z.string().min(1).max(500),
    contentType: z.string().max(200),
    sizeBytes: z.number().int().min(0),
    storageKey: z.string().min(1),
    description: z.string().max(500).optional(),
  }))
  .returns(z.promise(Attachment));

/** Get an attachment by ID */
export const GetAttachment = z.function()
  .args(z.object({ attachmentId: Id }))
  .returns(z.promise(Attachment));

/** Delete an attachment */
export const DeleteAttachment = z.function()
  .args(z.object({ attachmentId: Id }))
  .returns(z.promise(z.void()));

/** List attachments on a target */
export const ListAttachments = z.function()
  .args(z.object({
    targetType: z.string().min(1),
    targetId: Id,
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Attachment)));
