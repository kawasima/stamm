import { z } from "zod";
import {
  DateString,
  Hours,
  Id,
  MarkdownContent,
  PaginationParams,
  Percentage,
} from "../schema/common.js";
import {
  Issue,
  IssueAssignee,
  IssueDetail,
  IssueEstimation,
  IssueInclude,
  IssueListItem,
  IssueProgress,
  IssueSchedule,
  IssueStatusChange,
  IssueScheduleChange,
  IssueEstimationChange,
  IssueVisibility,
} from "../schema/issue.js";
import {
  IssueCategory,
  IssueLabel,
  IssueMilestone,
  IssueParent,
  IssueWatcher,
} from "../schema/intersection.js";
import { CustomFieldValue } from "../schema/custom-field.js";
import { IssueFilter } from "../schema/filter.js";
import { PaginatedResult, SortDirection } from "./common.js";

export { IssueFilter };

// ============================================================
// Issue CRUD
// ============================================================

/** Create a new issue (compound: can set assignees, labels, milestone, etc. in one call) */
export const CreateIssue = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id,
    issueTypeId: Id,
    priorityId: Id,
    // Initial status; falls back to the project+type DefaultStatusSetting.
    statusId: Id.optional(),
    subject: z.string().min(1).max(500),
    description: MarkdownContent.optional(),
    visibility: IssueVisibility.optional(),
    customFields: z.array(CustomFieldValue).max(200).optional(),
    // Compound fields — set in one call for convenience
    assigneeIds: z.array(Id).max(200).optional(),
    labelIds: z.array(Id).max(200).optional(),
    milestoneId: Id.optional(),
    categoryId: Id.optional(),
    parentIssueId: Id.optional(),
    startDate: DateString.optional(),
    dueDate: DateString.optional(),
    estimatedHours: Hours.optional(),
  }))
  .returns(z.promise(Issue));

// `actorId` on reads is the VIEWER: required to enforce Issue.visibility=private
// and Role.issuesVisibility="own_or_assigned" (see schema/user.ts).

/** Get an issue by ID */
export const GetIssue = z.function()
  .args(z.object({ actorId: Id, issueId: Id }))
  .returns(z.promise(Issue));

/** Get an issue by its key (e.g., "PROJ-123") */
export const GetIssueByKey = z.function()
  .args(z.object({ actorId: Id, key: z.string() }))
  .returns(z.promise(Issue));

/**
 * Get an issue joined with its bounded satellites (assignees, labels, schedule,
 * etc.) in one round-trip. Unbounded collections (comments, attachments,
 * time-entries, children, history) stay behind their own List* operations.
 */
export const GetIssueDetail = z.function()
  .args(z.object({ actorId: Id, issueId: Id }))
  .returns(z.promise(IssueDetail));

/** Update issue fields (subject, description, priority, type, custom fields, visibility) */
export const UpdateIssue = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    issueTypeId: Id.optional(),
    priorityId: Id.optional(),
    subject: z.string().min(1).max(500).optional(),
    description: MarkdownContent.optional(),
    visibility: IssueVisibility.optional(),
    customFields: z.array(CustomFieldValue).max(200).optional(),
  }))
  .returns(z.promise(Issue));

/** Delete an issue */
export const DeleteIssue = z.function()
  .args(z.object({ actorId: Id, issueId: Id }))
  .returns(z.promise(z.void()));

/** Move an issue to a different project */
export const MoveIssue = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    targetProjectId: Id,
    newIssueTypeId: Id.optional(),
  }))
  .returns(z.promise(Issue));

// ============================================================
// Issue Search / Filtering
// (IssueFilter is defined in schema/filter.ts and re-exported above)
// ============================================================

/**
 * List issues with rich filtering, sorting, and pagination.
 *
 * `actorId` is the viewer (visibility scoping — see GetIssue note above).
 * `include` embeds bounded satellites into each row (IssueListItem) to avoid
 * N+1 when rendering a board/table; omit it to get bare Issue-shaped rows.
 *
 * sortBy "createdAt"/"updatedAt" resolve against ActivityEntry (the canonical
 * timeline), and "dueDate" against IssueSchedule — neither lives on the Issue
 * body (see schema/filter.ts, schema/activity.ts).
 */
export const ListIssues = z.function()
  .args(z.object({
    actorId: Id,
    filter: IssueFilter,
    include: z.array(IssueInclude).optional(),
    sortBy: z.enum([
      "number", "subject", "priority", "status", "issueType",
      "createdAt", "updatedAt", "dueDate", "assignee",
    ]).optional(),
    sortDirection: SortDirection.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(IssueListItem)));

// ============================================================
// Status Transitions (workflow-aware)
// ============================================================

/**
 * Transition an issue to a new status (respects WorkflowTransition rules).
 * Updates Issue.statusId (current state) and appends an IssueStatusChange
 * event (history) in the same operation.
 */
export const TransitionIssueStatus = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    toStatusId: Id,
  }))
  .returns(z.promise(Issue));

/** Get available status transitions for an issue (viewer's roles gate them) */
export const GetAvailableTransitions = z.function()
  .args(z.object({ actorId: Id, issueId: Id }))
  .returns(z.promise(z.object({
    transitions: z.array(z.object({
      toStatusId: Id,
      toStatusName: z.string(),
    })),
  })));

/** List the status change history of an issue (cycle-time / time-in-status data) */
export const ListIssueStatusHistory = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(IssueStatusChange)));

/** List an issue's schedule (start/due date) change history */
export const ListIssueScheduleHistory = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(IssueScheduleChange)));

/** List an issue's estimation change history */
export const ListIssueEstimationHistory = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(IssueEstimationChange)));

// ============================================================
// Assignment (supports multiple assignees)
// ============================================================

/** Assign a user to an issue */
export const AssignIssue = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    assigneeId: Id,
  }))
  .returns(z.promise(IssueAssignee));

/** Unassign a user from an issue */
export const UnassignIssue = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    assigneeId: Id,
  }))
  .returns(z.promise(z.void()));

/** Replace all assignees of an issue at once */
export const SetIssueAssignees = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    assigneeIds: z.array(Id).max(200),
  }))
  .returns(z.promise(z.object({ assignees: z.array(IssueAssignee) })));

/** List assignees of an issue */
export const ListIssueAssignees = z.function()
  .args(z.object({ issueId: Id }))
  .returns(z.promise(z.object({ assignees: z.array(IssueAssignee) })));

// ============================================================
// Labeling
// ============================================================

/** Add a label to an issue */
export const AddIssueLabel = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    labelId: Id,
  }))
  .returns(z.promise(IssueLabel));

/** Remove a label from an issue */
export const RemoveIssueLabel = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    labelId: Id,
  }))
  .returns(z.promise(z.void()));

/** Replace all labels on an issue */
export const SetIssueLabels = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    labelIds: z.array(Id).max(200),
  }))
  .returns(z.promise(z.object({ labels: z.array(IssueLabel) })));

/** List labels on an issue */
export const ListIssueLabels = z.function()
  .args(z.object({ issueId: Id }))
  .returns(z.promise(z.object({ labels: z.array(IssueLabel) })));

// ============================================================
// Issue Category (Redmine-style per-project categories)
// ============================================================

/** Set the category of an issue */
export const SetIssueCategory = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    categoryId: Id,
  }))
  .returns(z.promise(IssueCategory));

/** Remove category from an issue */
export const RemoveIssueCategory = z.function()
  .args(z.object({ actorId: Id, issueId: Id }))
  .returns(z.promise(z.void()));

// ============================================================
// Issue Milestone
// ============================================================

/** Set the milestone of an issue */
export const SetIssueMilestone = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    milestoneId: Id,
  }))
  .returns(z.promise(IssueMilestone));

/** Remove milestone from an issue */
export const RemoveIssueMilestone = z.function()
  .args(z.object({ actorId: Id, issueId: Id }))
  .returns(z.promise(z.void()));

// ============================================================
// Issue Parent-Child (subtasks)
// ============================================================

/** Set the parent of an issue (making it a subtask) */
export const SetIssueParent = z.function()
  .args(z.object({
    actorId: Id,
    childIssueId: Id,
    parentIssueId: Id,
  }))
  .returns(z.promise(IssueParent));

/** Remove parent relationship */
export const RemoveIssueParent = z.function()
  .args(z.object({ actorId: Id, childIssueId: Id }))
  .returns(z.promise(z.void()));

/** List child issues (subtasks) of an issue */
export const ListChildIssues = z.function()
  .args(z.object({
    actorId: Id,
    parentIssueId: Id,
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Issue)));

// ============================================================
// Watching (GitHub-style subscriptions)
// ============================================================

/** Watch an issue */
export const WatchIssue = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
  }))
  .returns(z.promise(IssueWatcher));

/** Unwatch an issue */
export const UnwatchIssue = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
  }))
  .returns(z.promise(z.void()));

/** Check if a user is watching an issue */
export const IsWatchingIssue = z.function()
  .args(z.object({
    issueId: Id,
    userId: Id,
  }))
  .returns(z.promise(z.object({ watching: z.boolean() })));

/** List watchers of an issue */
export const ListIssueWatchers = z.function()
  .args(z.object({ actorId: Id, issueId: Id }))
  .returns(z.promise(z.object({ watchers: z.array(IssueWatcher) })));

// ============================================================
// Schedule, Estimation, Progress
// ============================================================

/** Set or update the schedule (start/due date) of an issue */
export const SetIssueSchedule = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    startDate: DateString.optional(),
    dueDate: DateString.optional(),
  }))
  .returns(z.promise(IssueSchedule));

/** Set or update the estimated hours of an issue */
export const SetIssueEstimation = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    estimatedHours: Hours,
  }))
  .returns(z.promise(IssueEstimation));

/** Set or update the done ratio (progress percentage) of an issue */
export const SetIssueProgress = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    doneRatio: Percentage,
  }))
  .returns(z.promise(IssueProgress));

// ============================================================
// Bulk Operations
// ============================================================

/** Bulk update multiple issues at once */
export const BulkUpdateIssues = z.function()
  .args(z.object({
    actorId: Id,
    issueIds: z.array(Id).min(1).max(1000),
    priorityId: Id.optional(),
    issueTypeId: Id.optional(),
    assigneeIds: z.array(Id).max(200).optional(),
    labelIds: z.array(Id).max(200).optional(),
    milestoneId: Id.optional(),
    categoryId: Id.optional(),
    statusId: Id.optional(),
    dueDate: DateString.optional(),
    visibility: IssueVisibility.optional(),
  }))
  .returns(z.promise(z.object({
    updated: z.array(Issue),
    failed: z.array(z.object({
      issueId: Id,
      reason: z.string(),
    })),
  })));

/** Bulk delete multiple issues */
export const BulkDeleteIssues = z.function()
  .args(z.object({
    actorId: Id,
    issueIds: z.array(Id).min(1).max(1000),
  }))
  .returns(z.promise(z.object({
    deletedCount: z.number().int(),
  })));
