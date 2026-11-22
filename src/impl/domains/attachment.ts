import { sql } from "kysely";
import { Attachment } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { assertCanWrite, isGlobalAdmin } from "../permissions.js";
import { assertCanReadIssue } from "../issue-visibility.js";
import { listPage } from "../listing.js";

type AttachmentMethods = "createAttachment" | "getAttachment" | "deleteAttachment" | "listAttachments";

/**
 * Attachments store metadata only (filename/contentType/size/storageKey); the
 * binary lives elsewhere, referenced by storageKey. Permission is gated when the
 * target is an issue (the only target type in v1 scope).
 */
export function attachmentBehaviors(ctx: Ctx): Pick<Behaviors, AttachmentMethods> {
  const db = ctx.db;
  const codec = makeCodec(Attachment);

  const gate = async (targetType: string, targetId: string, actorId: string, perm: "attachment.create" | "attachment.delete") => {
    if (targetType !== "issue") return; // other target types are out of v1 scope
    const row = await db.selectFrom("issues").select("project_id").where("id", "=", targetId).executeTakeFirst();
    if (!row) throw new NotFoundError("Issue", targetId);
    await assertCanWrite(ctx, row.project_id, actorId, perm);
  };

  /** Read gate: an attachment on an issue is only visible to those who can see
   *  the issue. Non-issue targets are out of v1 scope (open). */
  const gateRead = async (targetType: string, targetId: string, actorId: string) => {
    if (targetType !== "issue") return;
    // An admin may still audit what was attached to a since-deleted issue.
    if (await isGlobalAdmin(ctx, actorId)) return;
    await assertCanReadIssue(ctx, targetId, actorId);
  };

  return {
    createAttachment: async ({ targetType, targetId, actorId, filename, contentType, sizeBytes, storageKey, description }) => {
      await gate(targetType, targetId, actorId, "attachment.create");
      const attachment = Attachment.parse({ id: ctx.genId(), occurredAt: ctx.now(), targetType, targetId, filename, contentType, sizeBytes, authorId: actorId, storageKey, description });
      await db.insertInto("attachments").values(codec.encode(attachment) as never).execute();
      return attachment;
    },

    getAttachment: async ({ actorId, attachmentId }) => {
      const row = await db.selectFrom("attachments").selectAll().where("id", "=", attachmentId).executeTakeFirst();
      if (!row) throw new NotFoundError("Attachment", attachmentId);
      await gateRead(row.target_type, row.target_id, actorId);
      return codec.decode(row);
    },

    deleteAttachment: async ({ actorId, attachmentId }) => {
      const row = await db.selectFrom("attachments").select(["target_type", "target_id"]).where("id", "=", attachmentId).executeTakeFirst();
      if (!row) throw new NotFoundError("Attachment", attachmentId);
      await gate(row.target_type, row.target_id, actorId, "attachment.delete");
      await db.deleteFrom("attachments").where("id", "=", attachmentId).execute();
    },

    listAttachments: async ({ actorId, targetType, targetId, pagination }) => {
      await gateRead(targetType, targetId, actorId);
      const q = db.selectFrom("attachments").selectAll().where("target_type", "=", targetType).where("target_id", "=", targetId);
      const page = await listPage(q, { name: "attachments", keys: [{ by: sql.ref("occurred_at"), dir: "asc" }] }, "id", pagination);
      return { items: page.items.map((r) => codec.decode(r)), nextCursor: page.nextCursor };
    },
  };
}
