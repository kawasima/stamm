import { sql, type RawBuilder } from "kysely";
import { Comment, CommentListItem } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { appendActivity } from "../timeline.js";
import { notifyIssueEvent, notifyMentions, resolveMentionRecipients } from "../notifications.js";
import { isGlobalAdmin } from "../permissions.js";
import { asMissing, assertCanReadIssue, assertCanWriteIssue, issueVisible } from "../issue-visibility.js";
import { issueMatches } from "../issue-filter.js";
import { contains, listPage, stored } from "../listing.js";
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

  /**
   * SQL condition on a row of `comments` joined to its row of `issues`: may `actorId`
   * read it? They must be able to read the issue; a private comment is also for
   * members of its project, its author and global admins only.
   */
  const commentVisible = async (actorId: string): Promise<RawBuilder<boolean>> => {
    const onReadable = await issueVisible(ctx, actorId);
    if (await isGlobalAdmin(ctx, actorId)) return onReadable;
    return sql<boolean>`(${onReadable} and (
      comments.visibility = 'public'
      or comments.author_id = ${actorId}
      or exists(select 1 from project_memberships cm where cm.project_id = issues.project_id and cm.user_id = ${actorId})))`;
  };

  /** The comment, if the actor can read it. One they can't is reported as missing. */
  const readComment = async (actorId: string, commentId: string): Promise<Comment> => {
    const row = await db.selectFrom("comments").innerJoin("issues", "issues.id", "comments.issue_id").selectAll("comments")
      .where("comments.id", "=", commentId).where(await commentVisible(actorId)).executeTakeFirst();
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
    await asMissing("Comment", comment.id, () => assertCanWriteIssue(ctx, comment.issueId, actorId, perm));
    if (comment.authorId !== actorId && !(await isGlobalAdmin(ctx, actorId))) {
      throw new ForbiddenError(`User ${actorId} may not change a comment written by ${comment.authorId}`);
    }
  };

  return {
    createComment: async ({ issueId, actorId, body, visibility }) => {
      const projectId = await assertCanWriteIssue(ctx, issueId, actorId, "comment.create");
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
        await notifyIssueEvent(ctx, trx, { projectId, issueId, authorId, eventType: "issue.commented", title: "New comment", actorId, occurredAt: comment.occurredAt, exclude: mentioned, membersOnly: comment.visibility === "private" });
      });
      return comment;
    },

    getComment: ({ actorId, commentId }) => readComment(actorId, commentId),

    updateComment: async ({ actorId, commentId, body, visibility }) => {
      const current = await readComment(actorId, commentId);
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
      const current = await readComment(actorId, commentId);
      await assertCanModify(actorId, current, "comment.delete");
      await db.deleteFrom("comments").where("id", "=", commentId).execute();
    },

    listComments: async ({ actorId, issueId, issues, authorIds, occurredFrom, occurredUntil, query, sortDirection, pagination }) => {
      if ((issueId === undefined) === (issues === undefined)) throw new ValidationError("Give exactly one of issueId and issues");
      if (issueId !== undefined) await assertCanReadIssue(ctx, issueId, actorId);
      let q = db.selectFrom("comments").innerJoin("issues", "issues.id", "comments.issue_id").selectAll("comments")
        .select(["issues.project_id as of_project", "issues.key as of_key", "issues.number as of_number", "issues.subject as of_subject"])
        .where(await commentVisible(actorId));
      if (issueId !== undefined) q = q.where("comments.issue_id", "=", issueId);
      if (issues !== undefined) q = q.where(issueMatches(issues, ctx.now().slice(0, 10)));
      if (authorIds) q = q.where("comments.author_id", "in", authorIds);
      if (occurredFrom) q = q.where("comments.occurred_at", ">=", stored(occurredFrom));
      if (occurredUntil) q = q.where("comments.occurred_at", "<", stored(occurredUntil));
      if (query) q = q.where(contains(sql.ref("comments.body"), query));
      const page = await listPage(q, { name: "comments", keys: [{ by: sql.ref("comments.occurred_at"), dir: sortDirection ?? "asc" }] }, "comments.id", pagination);
      return {
        items: page.items.map(({ of_project, of_key, of_number, of_subject, ...row }) =>
          CommentListItem.parse({ ...codec.decode(row), issue: { projectId: of_project, key: of_key, number: of_number, subject: of_subject } })),
        nextCursor: page.nextCursor,
      };
    },
  };
}
