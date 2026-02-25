import { z } from "zod";
import {
  DateString,
  Hours,
  Id,
  IssueKey,
  LongTermEvent,
  MarkdownContent,
  Percentage,
  Resource,
} from "./common.js";
import { CustomFieldValue } from "./custom-field.js";

// ============================================================
// Issue - Long-Term Event
// ============================================================

export const IssueStatus = z.enum(["open", "in_progress", "resolved", "closed"]);
export const IssueVisibility = z.enum(["public", "private"]);

export const Issue = LongTermEvent
  .merge(IssueKey)
  .extend({
    projectId: Id,
    issueTypeId: Id,
    priorityId: Id,
    status: IssueStatus.default("open"),

    subject: z.string().min(1).max(500),
    description: MarkdownContent.optional(),
    authorId: Id,
    visibility: IssueVisibility.default("public"),

    customFields: z.array(CustomFieldValue).default([]),
  });

// ============================================================
// Current state (R) - intersection entities
// ============================================================

/** Current assignees (R) - 1:N for multiple assignees */
export const IssueAssignee = Resource.extend({
  issueId: Id,
  assigneeId: Id,
});

/** Current schedule (R) */
export const IssueSchedule = Resource.extend({
  issueId: Id,
  startDate: DateString.optional(),
  dueDate: DateString.optional(),
});

/** Current estimation (R) */
export const IssueEstimation = Resource.extend({
  issueId: Id,
  estimatedHours: Hours,
});

/** Current progress (R) */
export const IssueProgress = Resource.extend({
  issueId: Id,
  doneRatio: Percentage,
});

export type IssueStatus = z.infer<typeof IssueStatus>;
export type IssueVisibility = z.infer<typeof IssueVisibility>;
export type Issue = z.infer<typeof Issue>;
export type IssueAssignee = z.infer<typeof IssueAssignee>;
export type IssueSchedule = z.infer<typeof IssueSchedule>;
export type IssueEstimation = z.infer<typeof IssueEstimation>;
export type IssueProgress = z.infer<typeof IssueProgress>;
