import { z } from "zod";
import { Event, Id, MarkdownContent, Resource, SortOrder } from "./common.js";

// ============================================================
// Draft Issues (GitHub Projects draft items)
//
// A lightweight, not-yet-real item that lives only on a board until it is
// promoted to a full Issue. No delete flag: promotion is recorded as a
// DraftConversion event linking the draft to the created issue.
// ============================================================

export const DraftIssue = Resource.extend({
  projectId: Id,
  title: z.string().min(1).max(500),
  body: MarkdownContent.optional(),
  authorId: Id,
  sortOrder: SortOrder,
});

/** Draft -> Issue promotion (E) */
export const DraftConversion = Event.extend({
  draftId: Id,
  issueId: Id,
  userId: Id,
});

export type DraftIssue = z.infer<typeof DraftIssue>;
export type DraftConversion = z.infer<typeof DraftConversion>;
