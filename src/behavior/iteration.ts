import { z } from "zod";
import { DateString, Id, PaginationParams, SortOrder } from "../schema/common.js";
import {
  IssueIteration,
  Iteration,
} from "../schema/iteration.js";
import { PaginatedResult, SortDirection } from "./common.js";

// ============================================================
// Iteration CRUD
// ============================================================

/** Create an iteration in a project */
export const CreateIteration = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id,
    name: z.string().min(1).max(200),
    startDate: DateString,
    endDate: DateString,
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(Iteration));

/** Get an iteration by ID */
export const GetIteration = z.function()
  .args(z.object({ iterationId: Id }))
  .returns(z.promise(Iteration));

/** Update an iteration */
export const UpdateIteration = z.function()
  .args(z.object({
    actorId: Id,
    iterationId: Id,
    name: z.string().min(1).max(200).optional(),
    startDate: DateString.optional(),
    endDate: DateString.optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(Iteration));

/** Delete an iteration */
export const DeleteIteration = z.function()
  .args(z.object({ actorId: Id, iterationId: Id }))
  .returns(z.promise(z.void()));

/** List iterations in a project */
export const ListIterations = z.function()
  .args(z.object({
    projectId: Id,
    sortBy: z.enum(["name", "startDate", "sortOrder"]).optional(),
    sortDirection: SortDirection.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Iteration)));

// ============================================================
// Issue <-> Iteration
// ============================================================

/** Assign an issue to an iteration */
export const SetIssueIteration = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    iterationId: Id,
  }))
  .returns(z.promise(IssueIteration));

/** Remove an issue from its iteration */
export const RemoveIssueIteration = z.function()
  .args(z.object({ actorId: Id, issueId: Id }))
  .returns(z.promise(z.void()));

// ============================================================
// Iteration Aggregation
// ============================================================

/** Get iteration progress (issue counts and completion percentage) */
export const GetIterationProgress = z.function()
  .args(z.object({ iterationId: Id }))
  .returns(z.promise(z.object({
    iterationId: Id,
    totalIssues: z.number().int(),
    openIssues: z.number().int(),
    closedIssues: z.number().int(),
    completionPercentage: z.number().min(0).max(100),
  })));
