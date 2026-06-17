import { z } from "zod";
import {
  DateString,
  Event,
  Hours,
  Id,
  IssueKey,
  LongTermEvent,
  MarkdownContent,
  Percentage,
  Resource,
} from "./common.js";
import { CustomFieldValue } from "./custom-field.js";
import {
  IssueCategory,
  IssueLabel,
  IssueMilestone,
  IssueParent,
  IssueWatcher,
} from "./intersection.js";
import { IssueIteration } from "./iteration.js";
import { IssueRelation } from "./issue-relation.js";

// ============================================================
// Issue - Long-Term Event
// ============================================================

export const IssueVisibility = z.enum(["public", "private"]);

// Issue is a LongTermEvent whose lifecycle status IS its workflow status.
// We omit the inherited string `status` and replace it with `statusId`, a
// reference to a Status resource (see status.ts). The current status lives on
// the Issue body (single-generation table pattern); the change history is
// captured as IssueStatusChange events below.
export const Issue = LongTermEvent
  .omit({ status: true })
  .merge(IssueKey)
  .extend({
    projectId: Id,
    issueTypeId: Id,
    priorityId: Id,
    statusId: Id,

    subject: z.string().min(1).max(500),
    description: MarkdownContent.optional(),
    authorId: Id,
    visibility: IssueVisibility.default("public"),

    customFields: z.array(CustomFieldValue).default([]),
  });

/** Issue status change (E) - append-only history of status transitions */
export const IssueStatusChange = Event.extend({
  issueId: Id,
  fromStatusId: Id.optional(),
  toStatusId: Id,
  userId: Id,
});

/** Issue schedule change (E) - append-only history of start/due date changes */
export const IssueScheduleChange = Event.extend({
  issueId: Id,
  fromStartDate: DateString.optional(),
  toStartDate: DateString.optional(),
  fromDueDate: DateString.optional(),
  toDueDate: DateString.optional(),
  userId: Id,
});

/** Issue estimation change (E) - append-only history of estimate changes */
export const IssueEstimationChange = Event.extend({
  issueId: Id,
  fromHours: Hours.optional(),
  toHours: Hours,
  userId: Id,
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

// ============================================================
// Compound read models (derived — not persisted)
//
// The write side is compound (CreateIssue sets assignees/labels/etc. in one
// call) but the read side was not: GetIssue returned the bare Issue and every
// satellite needed its own call (N+1). These read models join an Issue with its
// bounded satellites so a UI can render a card / detail page in one round-trip.
//
// Unbounded collections (comments, attachments, time-entries, child issues,
// status history, activity) are deliberately NOT embedded — they stay behind
// their own paginated List* operations.
// ============================================================

/**
 * Fully-hydrated issue for a detail view. Arrays are always present (possibly
 * empty); 0..1 satellites are optional. Used by GetIssueDetail.
 */
export const IssueDetail = Issue.extend({
  assignees: z.array(IssueAssignee), // 1:N
  labels: z.array(IssueLabel), // 1:N
  watchers: z.array(IssueWatcher), // 1:N
  relations: z.array(IssueRelation), // 1:N (bounded by convention — see ListIssues)
  category: IssueCategory.optional(), // 0..1
  milestone: IssueMilestone.optional(),
  iteration: IssueIteration.optional(),
  parent: IssueParent.optional(),
  schedule: IssueSchedule.optional(),
  estimation: IssueEstimation.optional(),
  progress: IssueProgress.optional(),
});

/**
 * Partially-hydrated issue for list rows. Every satellite is optional: it is
 * populated only when requested via ListIssues `include`. For arrays,
 * `undefined` means "not requested" and `[]` means "requested, none exist".
 */
export const IssueListItem = Issue.extend({
  assignees: z.array(IssueAssignee).optional(),
  labels: z.array(IssueLabel).optional(),
  watchers: z.array(IssueWatcher).optional(),
  relations: z.array(IssueRelation).optional(),
  category: IssueCategory.optional(),
  milestone: IssueMilestone.optional(),
  iteration: IssueIteration.optional(),
  parent: IssueParent.optional(),
  schedule: IssueSchedule.optional(),
  estimation: IssueEstimation.optional(),
  progress: IssueProgress.optional(),
});

/** Satellites embeddable into ListIssues rows via `include`. */
export const IssueInclude = z.enum([
  "assignees",
  "labels",
  "watchers",
  "relations",
  "category",
  "milestone",
  "iteration",
  "parent",
  "schedule",
  "estimation",
  "progress",
]);

export type IssueVisibility = z.infer<typeof IssueVisibility>;
export type Issue = z.infer<typeof Issue>;
export type IssueStatusChange = z.infer<typeof IssueStatusChange>;
export type IssueScheduleChange = z.infer<typeof IssueScheduleChange>;
export type IssueEstimationChange = z.infer<typeof IssueEstimationChange>;
export type IssueAssignee = z.infer<typeof IssueAssignee>;
export type IssueSchedule = z.infer<typeof IssueSchedule>;
export type IssueEstimation = z.infer<typeof IssueEstimation>;
export type IssueProgress = z.infer<typeof IssueProgress>;
export type IssueDetail = z.infer<typeof IssueDetail>;
export type IssueListItem = z.infer<typeof IssueListItem>;
export type IssueInclude = z.infer<typeof IssueInclude>;
