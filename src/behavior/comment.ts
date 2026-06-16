import { z } from "zod";
import { Id, MarkdownContent, PaginationParams } from "../schema/common.js";
import { Comment, CommentVisibility, Reaction } from "../schema/comment.js";
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
  .args(z.object({ commentId: Id }))
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

/** List comments on an issue */
export const ListComments = z.function()
  .args(z.object({
    issueId: Id,
    sortDirection: SortDirection.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Comment)));

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
