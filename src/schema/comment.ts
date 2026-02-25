import { z } from "zod";
import { Event, Id, MarkdownContent, TargetRef, Timestamp } from "./common.js";

// ============================================================
// Events (E)
// ============================================================

export const CommentVisibility = z.enum(["public", "private"]);

/** Comment (E) - posting a comment is an event */
export const Comment = Event.extend({
  issueId: Id,
  authorId: Id,
  body: MarkdownContent.min(1),
  visibility: CommentVisibility.default("public"),
});

/** Reaction (E) - reacting is an event */
export const Reaction = z.object({
  id: Id,
  userId: Id,
  emoji: z.string().min(1).max(50),
  occurredAt: Timestamp,
}).merge(TargetRef);

export type CommentVisibility = z.infer<typeof CommentVisibility>;
export type Comment = z.infer<typeof Comment>;
export type Reaction = z.infer<typeof Reaction>;
