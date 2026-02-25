import { z } from "zod";
import { DateString, Id, PaginationParams, SortOrder } from "../schema/common.js";
import { Milestone, MilestoneStatus } from "../schema/milestone.js";
import { PaginatedResult, SortDirection } from "./common.js";

// ============================================================
// Milestone CRUD
// ============================================================

/** Create a milestone in a project */
export const CreateMilestone = z.function()
  .args(z.object({
    projectId: Id,
    name: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    startDate: DateString.optional(),
    dueDate: DateString.optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(Milestone));

/** Get a milestone by ID */
export const GetMilestone = z.function()
  .args(z.object({ milestoneId: Id }))
  .returns(z.promise(Milestone));

/** Update a milestone */
export const UpdateMilestone = z.function()
  .args(z.object({
    milestoneId: Id,
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    startDate: DateString.optional(),
    dueDate: DateString.optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(Milestone));

/** Delete a milestone */
export const DeleteMilestone = z.function()
  .args(z.object({ milestoneId: Id }))
  .returns(z.promise(z.void()));

/** List milestones in a project */
export const ListMilestones = z.function()
  .args(z.object({
    projectId: Id,
    status: MilestoneStatus.optional(),
    sortBy: z.enum(["name", "dueDate", "sortOrder"]).optional(),
    sortDirection: SortDirection.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Milestone)));

// ============================================================
// Milestone State Transitions
// ============================================================

/** Close a milestone */
export const CloseMilestone = z.function()
  .args(z.object({
    milestoneId: Id,
    releaseDate: DateString.optional(),
  }))
  .returns(z.promise(Milestone));

/** Reopen a milestone */
export const ReopenMilestone = z.function()
  .args(z.object({ milestoneId: Id }))
  .returns(z.promise(Milestone));

/** Lock a milestone (Redmine: no further changes allowed) */
export const LockMilestone = z.function()
  .args(z.object({ milestoneId: Id }))
  .returns(z.promise(Milestone));

// ============================================================
// Milestone Aggregation
// ============================================================

/** Get milestone progress (issue counts and completion percentage) */
export const GetMilestoneProgress = z.function()
  .args(z.object({ milestoneId: Id }))
  .returns(z.promise(z.object({
    milestoneId: Id,
    totalIssues: z.number().int(),
    openIssues: z.number().int(),
    closedIssues: z.number().int(),
    completionPercentage: z.number().min(0).max(100),
  })));
