import { z } from "zod";
import { DateString, Hours, Id, PaginationParams, SortOrder } from "../schema/common.js";
import { TimeEntry, TimeEntryActivity } from "../schema/time-entry.js";
import { PaginatedResult, SortDirection } from "./common.js";

// ============================================================
// Time Entry Activities
// ============================================================

/** Create a time entry activity type */
export const CreateTimeEntryActivity = z.function()
  .args(z.object({
    actorId: Id,
    name: z.string().min(1).max(100),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(TimeEntryActivity));

/** Update a time entry activity type */
export const UpdateTimeEntryActivity = z.function()
  .args(z.object({
    actorId: Id,
    activityId: Id,
    name: z.string().min(1).max(100).optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(TimeEntryActivity));

/** Delete a time entry activity type */
export const DeleteTimeEntryActivity = z.function()
  .args(z.object({ actorId: Id, activityId: Id }))
  .returns(z.promise(z.void()));

/** List all time entry activity types */
export const ListTimeEntryActivities = z.function()
  .args(z.object({ pagination: PaginationParams }))
  .returns(z.promise(PaginatedResult(TimeEntryActivity)));

// ============================================================
// Time Entries
// ============================================================

/** Log a time entry */
export const CreateTimeEntry = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id,
    issueId: Id.optional(),
    userId: Id,
    activityId: Id,
    hours: Hours,
    spentOn: DateString,
    comment: z.string().max(1000).optional(),
  }))
  .returns(z.promise(TimeEntry));

/** Get a time entry by ID */
export const GetTimeEntry = z.function()
  .args(z.object({ actorId: Id, timeEntryId: Id }))
  .returns(z.promise(TimeEntry));

/** Update a time entry */
export const UpdateTimeEntry = z.function()
  .args(z.object({
    actorId: Id,
    timeEntryId: Id,
    activityId: Id.optional(),
    hours: Hours.optional(),
    spentOn: DateString.optional(),
    comment: z.string().max(1000).optional(),
  }))
  .returns(z.promise(TimeEntry));

/** Delete a time entry */
export const DeleteTimeEntry = z.function()
  .args(z.object({ actorId: Id, timeEntryId: Id }))
  .returns(z.promise(z.void()));

/** List time entries with filtering */
export const ListTimeEntries = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id.optional(),
    issueId: Id.optional(),
    userId: Id.optional(),
    activityId: Id.optional(),
    spentOnFrom: DateString.optional(),
    spentOnTo: DateString.optional(),
    sortBy: z.enum(["spentOn", "hours", "occurredAt"]).optional(),
    sortDirection: SortDirection.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(TimeEntry)));

// ============================================================
// Time Reporting / Aggregation
// ============================================================

/** Time summary grouped by specified dimension */
export const GetTimeSummary = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id.optional(),
    issueId: Id.optional(),
    userId: Id.optional(),
    spentOnFrom: DateString.optional(),
    spentOnTo: DateString.optional(),
    groupBy: z.enum(["user", "activity", "issue", "project", "date"]),
  }))
  .returns(z.promise(z.object({
    totalHours: Hours,
    groups: z.array(z.object({
      key: z.string(),
      label: z.string(),
      hours: Hours,
    })),
  })));
