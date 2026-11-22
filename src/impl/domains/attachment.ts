import { sql } from "kysely";
import { Attachment } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { isGlobalAdmin } from "../permissions.js";
import { asMissing, assertCanReadIssue, assertCanWriteIssue } from "../issue-visibility.js";
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

  const gate = (issueId: string, actorId: string, perm: "attachment.create" | "attachment.delete") => assertCanWriteIssue(ctx, issueId, actorId, perm);

  /** An attachment is visible to those who can see the issue it is on. */
  const gateRead = async (issueId: string, actorId: string): Promise<void> => {
    // An admin may still audit what was attached to a since-deleted issue.
    if (await isGlobalAdmin(ctx, actorId)) return;
    await assertCanReadIssue(ctx, issueId, actorId);
  };

  /** The row, unless it is on something other than an issue: nothing says who may see that. */
  const load = async (attachmentId: string) => {
    const row = await db.selectFrom("attachments").selectAll().where("id", "=", attachmentId).where("target_type", "=", "issue").executeTakeFirst();
    if (!row) throw new NotFoundError("Attachment", attachmentId);
    return row;
  };

  return {
    createAttachment: async ({ targetType, targetId, actorId, filename, contentType, sizeBytes, storageKey, description }) => {
      await gate(targetId, actorId, "attachment.create");
      const attachment = Attachment.parse({ id: ctx.genId(), occurredAt: ctx.now(), targetType, targetId, filename, contentType, sizeBytes, authorId: actorId, storageKey, description });
      await db.insertInto("attachments").values(codec.encode(attachment) as never).execute();
      return attachment;
    },

    getAttachment: async ({ actorId, attachmentId }) => {
      const row = await load(attachmentId);
      await asMissing("Attachment", attachmentId, () => gateRead(row.target_id, actorId));
      return codec.decode(row);
    },

    deleteAttachment: async ({ actorId, attachmentId }) => {
      const row = await load(attachmentId);
      await asMissing("Attachment", attachmentId, () => gate(row.target_id, actorId, "attachment.delete"));
      await db.deleteFrom("attachments").where("id", "=", attachmentId).execute();
    },

    listAttachments: async ({ actorId, targetType, targetId, pagination }) => {
      await gateRead(targetId, actorId);
      const q = db.selectFrom("attachments").selectAll().where("target_type", "=", targetType).where("target_id", "=", targetId);
      const page = await listPage(q, { name: "attachments", keys: [{ by: sql.ref("occurred_at"), dir: "asc" }] }, "id", pagination);
      return { items: page.items.map((r) => codec.decode(r)), nextCursor: page.nextCursor };
    },
  };
}
