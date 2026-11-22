import { sql } from "kysely";
import { Comment } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { appendActivity } from "../timeline.js";
import { notifyIssueEvent, notifyMentions, resolveMentionRecipients } from "../notifications.js";
import { assertCanWrite, canSeePrivateInProject, isGlobalAdmin } from "../permissions.js";
import { assertCanReadIssue } from "../issue-visibility.js";
import { listPage } from "../listing.js";
import { inTransaction } from "../tx.js";

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
  const issueKey = async (issueId: string): Promise<string> => {
    const row = await db.selectFrom("issues").select(["key", "number"]).where("id", "=", issueId).executeTakeFirst();
    return row ? `${row.key}-${row.number}` : issueId;
  };
  const loadComment = async (commentId: string): Promise<Comment> => {
    const row = await db.selectFrom("comments").selectAll().where("id", "=", commentId).executeTakeFirst();
    if (!row) throw new NotFoundError("Comment", commentId);
    return codec.decode(row);
  };

  /**
   * Editing or removing a comment needs the project permission and, on top of it,
   * authorship: a comment is someone's statement, so only its author or a global
   * admin (moderation) may change it. The issue must also be readable by the
   * actor, so a role limited to `own_or_assigned` can't edit comments on issues
   * it can't see.
   */
  const assertCanModify = async (actorId: string, comment: Comment, perm: "comment.update" | "comment.delete"): Promise<void> => {
    await assertCanReadIssue(ctx, comment.issueId, actorId);
    await assertCanWrite(ctx, await issueProjectId(comment.issueId), actorId, perm);
    if (comment.authorId !== actorId && !(await isGlobalAdmin(ctx, actorId))) {
      throw new ForbiddenError(`User ${actorId} may not change a comment written by ${comment.authorId}`);
    }
  };

  return {
    createComment: async ({ issueId, actorId, body, visibility }) => {
      const projectId = await issueProjectId(issueId);
      await assertCanWrite(ctx, projectId, actorId, "comment.create");
      const comment = Comment.parse({ id: ctx.genId(), occurredAt: ctx.now(), issueId, authorId: actorId, body, visibility: visibility ?? "public" });
      const authorId = await issueAuthor(issueId);
      // Resolved before the transaction: it reads through the normal connection.
      const mentioned = await resolveMentionRecipients(ctx, { projectId, issueId, actorId, body });
      const key = mentioned.length > 0 ? await issueKey(issueId) : "";
      await inTransaction(db, async (trx) => {
        await trx.insertInto("comments").values(codec.encode(comment) as never).execute();
        await appendActivity(ctx, trx, { projectId, userId: actorId, action: "commented", targetType: "issue", targetId: issueId, occurredAt: comment.occurredAt });
        // A mentioned user gets the mention, not also a generic "commented".
        await notifyMentions(ctx, trx, { projectId, issueKey: key, commentId: comment.id, recipients: mentioned, occurredAt: comment.occurredAt });
        await notifyIssueEvent(ctx, trx, { projectId, issueId, authorId, eventType: "issue.commented", title: "New comment", actorId, occurredAt: comment.occurredAt, exclude: mentioned });
      });
      return comment;
    },

    getComment: async ({ actorId, commentId }) => {
      const comment = await loadComment(commentId);
      await assertCanReadIssue(ctx, comment.issueId, actorId);
      // A private comment is members-only; hide it (NotFound, not Forbidden) from
      // a non-member who can otherwise read the issue. The author always sees it.
      if (comment.visibility === "private" && comment.authorId !== actorId) {
        const projectId = await issueProjectId(comment.issueId);
        if (!(await canSeePrivateInProject(ctx, projectId, actorId))) {
          throw new NotFoundError("Comment", commentId);
        }
      }
      return comment;
    },

    updateComment: async ({ actorId, commentId, body, visibility }) => {
      const current = await loadComment(commentId);
      await assertCanModify(actorId, current, "comment.update");
      const merged = Comment.parse({ ...current, body, ...(visibility !== undefined ? { visibility } : {}) });
      // Only people newly mentioned by the edit are notified, so fixing a typo
      // does not ping everyone again.
      const projectId = await issueProjectId(current.issueId);
      const before = new Set(await resolveMentionRecipients(ctx, { projectId, issueId: current.issueId, actorId, body: current.body }));
      const added = (await resolveMentionRecipients(ctx, { projectId, issueId: current.issueId, actorId, body })).filter((id) => !before.has(id));
      const key = added.length > 0 ? await issueKey(current.issueId) : "";
      await inTransaction(db, async (trx) => {
        await trx.updateTable("comments").set(codec.encode(merged) as never).where("id", "=", commentId).execute();
        await notifyMentions(ctx, trx, { projectId, issueKey: key, commentId, recipients: added, occurredAt: ctx.now() });
      });
      return merged;
    },

    deleteComment: async ({ actorId, commentId }) => {
      const current = await loadComment(commentId);
      await assertCanModify(actorId, current, "comment.delete");
      await db.deleteFrom("comments").where("id", "=", commentId).execute();
    },

    listComments: async ({ actorId, issueId, sortDirection, pagination }) => {
      await assertCanReadIssue(ctx, issueId, actorId);
      let q = db.selectFrom("comments").selectAll().where("issue_id", "=", issueId);
      // Members-only: a non-member who can read the issue still sees only public
      // comments (plus their own). Members and global admins see everything.
      const projectId = await issueProjectId(issueId);
      if (!(await canSeePrivateInProject(ctx, projectId, actorId))) {
        q = q.where((eb) => eb.or([eb("visibility", "=", "public"), eb("author_id", "=", actorId)]));
      }
      const page = await listPage(q, { name: "comments", keys: [{ by: sql.ref("occurred_at"), dir: sortDirection ?? "asc" }] }, "id", pagination);
      return { items: page.items.map((r) => codec.decode(r)), nextCursor: page.nextCursor };
    },
  };
}
