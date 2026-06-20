import { Comment } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { appendActivity } from "../timeline.js";
import { notifyIssueEvent } from "../notifications.js";
import { assertCanWrite, assertCanReadIssue } from "../permissions.js";
import { buildPage, decodeCursor } from "../pagination.js";

type CommentMethods = "createComment" | "getComment" | "updateComment" | "deleteComment" | "listComments";

export function commentBehaviors(ctx: Ctx): Pick<Behaviors, CommentMethods> {
  const db = ctx.db;
  const codec = makeCodec(Comment);

  const issueProjectId = async (issueId: string): Promise<string> => {
    const row = await db.selectFrom("issues").select("project_id").where("id", "=", issueId).executeTakeFirst();
    if (!row) throw new NotFoundError("Issue", issueId);
    return row.project_id;
  };
  const issueAuthor = async (issueId: string): Promise<string> => {
    const row = await db.selectFrom("issues").select("author_id").where("id", "=", issueId).executeTakeFirst();
    return row?.author_id ?? "";
  };
  const loadComment = async (commentId: string): Promise<Comment> => {
    const row = await db.selectFrom("comments").selectAll().where("id", "=", commentId).executeTakeFirst();
    if (!row) throw new NotFoundError("Comment", commentId);
    return codec.decode(row);
  };

  return {
    createComment: async ({ issueId, actorId, body, visibility }) => {
      const projectId = await issueProjectId(issueId);
      await assertCanWrite(ctx, projectId, actorId, "comment.create");
      const comment = Comment.parse({ id: ctx.genId(), occurredAt: ctx.now(), issueId, authorId: actorId, body, visibility: visibility ?? "public" });
      const authorId = await issueAuthor(issueId);
      await db.transaction().execute(async (trx) => {
        await trx.insertInto("comments").values(codec.encode(comment) as never).execute();
        await appendActivity(ctx, trx, { projectId, userId: actorId, action: "commented", targetType: "issue", targetId: issueId, occurredAt: comment.occurredAt });
        await notifyIssueEvent(ctx, trx, { projectId, issueId, authorId, eventType: "issue.commented", title: "New comment", actorId, occurredAt: comment.occurredAt });
      });
      return comment;
    },

    getComment: async ({ actorId, commentId }) => {
      const comment = await loadComment(commentId);
      await assertCanReadIssue(ctx, comment.issueId, actorId);
      return comment;
    },

    updateComment: async ({ actorId, commentId, body, visibility }) => {
      const current = await loadComment(commentId);
      await assertCanWrite(ctx, await issueProjectId(current.issueId), actorId, "comment.update");
      const merged = Comment.parse({ ...current, body, ...(visibility !== undefined ? { visibility } : {}) });
      await db.updateTable("comments").set(codec.encode(merged) as never).where("id", "=", commentId).execute();
      return merged;
    },

    deleteComment: async ({ actorId, commentId }) => {
      const current = await loadComment(commentId);
      await assertCanWrite(ctx, await issueProjectId(current.issueId), actorId, "comment.delete");
      await db.deleteFrom("comments").where("id", "=", commentId).execute();
    },

    listComments: async ({ actorId, issueId, sortDirection, pagination }) => {
      await assertCanReadIssue(ctx, issueId, actorId);
      const limit = pagination?.limit ?? 20;
      const dir: "asc" | "desc" = sortDirection === "desc" ? "desc" : "asc";
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("comments").selectAll().where("issue_id", "=", issueId);
      if (cursor) {
        const sep = cursor.indexOf(" ");
        const co = cursor.slice(0, sep);
        const ci = cursor.slice(sep + 1);
        q = dir === "asc"
          ? q.where((eb) => eb.or([eb("occurred_at", ">", co), eb.and([eb("occurred_at", "=", co), eb("id", ">", ci)])]))
          : q.where((eb) => eb.or([eb("occurred_at", "<", co), eb.and([eb("occurred_at", "=", co), eb("id", "<", ci)])]));
      }
      const rows = await q.orderBy("occurred_at", dir).orderBy("id", dir).limit(limit + 1).execute();
      const page = buildPage(rows.map((r) => codec.decode(r)), (c) => `${c.occurredAt} ${c.id}`, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },
  };
}
