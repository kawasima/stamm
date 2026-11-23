import { z } from "zod";
import { Id, MarkdownContent, PaginationParams, Timestamp } from "../schema/common.js";
import { Comment, CommentListItem, CommentVisibility, Reaction } from "../schema/comment.js";
import { IssueFilter } from "../schema/filter.js";
import { PaginatedResult, SortDirection } from "./common.js";

// ============================================================
// Comments
// ============================================================

/** Add a comment to an issue */
export const CreateComment = z.function()
  .args(z.object({
    issueId: Id,
    actorId: Id,
    body: MarkdownContent.min(1),
    visibility: CommentVisibility.optional(),
  }))
  .returns(z.promise(Comment));

/** Get a comment by ID */
export const GetComment = z.function()
  .args(z.object({ actorId: Id, commentId: Id }))
  .returns(z.promise(Comment));

/** Update a comment's body */
export const UpdateComment = z.function()
  .args(z.object({
    actorId: Id,
    commentId: Id,
    body: MarkdownContent.min(1),
    visibility: CommentVisibility.optional(),
  }))
  .returns(z.promise(Comment));

/** Delete a comment */
export const DeleteComment = z.function()
  .args(z.object({ actorId: Id, commentId: Id }))
  .returns(z.promise(z.void()));

/**
 * List comments, of one issue or of the issues matching a filter, by when they were
 * written. Give exactly one of `issueId` and `issues`.
 *
 * Only comments the actor can read are listed or searched. `occurredFrom` and
 * `occurredUntil` go by when a comment was written: an edit does not move it, and a
 * deleted one is gone, so a reader that wants those reads its range again.
 */
export const ListComments = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id.optional(),
    /** The issues to list comments of, as in ListIssues; `{}` is every issue the actor can read. */
    issues: IssueFilter.optional(),
    /** Only comments by these users. */
    authorIds: z.array(Id).min(1).max(200).optional(),
    /** Written at or after this instant. */
    occurredFrom: Timestamp.optional(),
    /** Written strictly before this instant. */
    occurredUntil: Timestamp.optional(),
    /** Only comments whose body contains this text, taken literally. */
    query: z.string().min(1).max(200).optional(),
    sortDirection: SortDirection.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(CommentListItem)));

// ============================================================
// Reactions (on comments, issues, or any target)
// ============================================================

/** Add a reaction to a target */
export const AddReaction = z.function()
  .args(z.object({
    targetType: z.string().min(1),
    targetId: Id,
    actorId: Id,
    emoji: z.string().min(1).max(50),
  }))
  .returns(z.promise(Reaction));

/** Remove a reaction */
export const RemoveReaction = z.function()
  .args(z.object({
    targetType: z.string().min(1),
    targetId: Id,
    actorId: Id,
    emoji: z.string().min(1).max(50),
  }))
  .returns(z.promise(z.void()));

/** List reactions on a target */
export const ListReactions = z.function()
  .args(z.object({
    targetType: z.string().min(1),
    targetId: Id,
  }))
  .returns(z.promise(z.object({
    reactions: z.array(Reaction),
  })));
