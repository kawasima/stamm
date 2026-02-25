import { z } from "zod";
import { DateString, Hours, Id, Percentage } from "../schema/common.js";

// ============================================================
// Aggregated Statistics (read-only query behaviors)
// ============================================================

/** Get issue count by status category for a project or milestone */
export const GetIssueStatusSummary = z.function()
  .args(z.object({
    projectId: Id,
    milestoneId: Id.optional(),
  }))
  .returns(z.promise(z.object({
    todo: z.number().int(),
    inProgress: z.number().int(),
    done: z.number().int(),
    total: z.number().int(),
  })));

/** Get issue count grouped by issue type */
export const GetIssueTypeSummary = z.function()
  .args(z.object({ projectId: Id }))
  .returns(z.promise(z.object({
    groups: z.array(z.object({
      issueTypeId: Id,
      issueTypeName: z.string(),
      count: z.number().int(),
    })),
  })));

/** Get issue count grouped by priority */
export const GetIssuePrioritySummary = z.function()
  .args(z.object({ projectId: Id }))
  .returns(z.promise(z.object({
    groups: z.array(z.object({
      priorityId: Id,
      priorityName: z.string(),
      count: z.number().int(),
    })),
  })));

/** Get issue count grouped by assignee */
export const GetIssueAssigneeSummary = z.function()
  .args(z.object({ projectId: Id }))
  .returns(z.promise(z.object({
    groups: z.array(z.object({
      assigneeId: Id,
      assigneeName: z.string(),
      count: z.number().int(),
    })),
    unassigned: z.number().int(),
  })));

/** Get burndown chart data for a milestone */
export const GetBurndownData = z.function()
  .args(z.object({
    milestoneId: Id,
    startDate: DateString.optional(),
    endDate: DateString.optional(),
  }))
  .returns(z.promise(z.object({
    dataPoints: z.array(z.object({
      date: DateString,
      totalIssues: z.number().int(),
      openIssues: z.number().int(),
      closedIssues: z.number().int(),
    })),
  })));

/** Get time tracking summary for a project */
export const GetProjectTimeSummary = z.function()
  .args(z.object({
    projectId: Id,
    spentOnFrom: DateString.optional(),
    spentOnTo: DateString.optional(),
  }))
  .returns(z.promise(z.object({
    totalSpentHours: Hours,
    totalEstimatedHours: Hours,
    averageDoneRatio: Percentage,
  })));

/** Get overdue issues summary */
export const GetOverdueIssuesSummary = z.function()
  .args(z.object({
    projectId: Id.optional(),
  }))
  .returns(z.promise(z.object({
    overdueCount: z.number().int(),
    dueTodayCount: z.number().int(),
    dueThisWeekCount: z.number().int(),
  })));
