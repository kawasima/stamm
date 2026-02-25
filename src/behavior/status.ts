import { z } from "zod";
import { HexColor, Id, PaginationParams, SortOrder } from "../schema/common.js";
import { Status, StatusCategory, WorkflowTransition } from "../schema/status.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Status CRUD
// ============================================================

/** Create a status */
export const CreateStatus = z.function()
  .args(z.object({
    name: z.string().min(1).max(100),
    category: StatusCategory,
    color: HexColor.optional(),
    description: z.string().max(500).optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(Status));

/** Get a status by ID */
export const GetStatus = z.function()
  .args(z.object({ statusId: Id }))
  .returns(z.promise(Status));

/** Update a status */
export const UpdateStatus = z.function()
  .args(z.object({
    statusId: Id,
    name: z.string().min(1).max(100).optional(),
    category: StatusCategory.optional(),
    color: HexColor.optional(),
    description: z.string().max(500).optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(Status));

/** Delete a status */
export const DeleteStatus = z.function()
  .args(z.object({ statusId: Id }))
  .returns(z.promise(z.void()));

/** List all statuses */
export const ListStatuses = z.function()
  .args(z.object({
    category: StatusCategory.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Status)));

// ============================================================
// Workflow Transitions
// ============================================================

/** Create a workflow transition rule */
export const CreateWorkflowTransition = z.function()
  .args(z.object({
    projectId: Id,
    issueTypeId: Id,
    fromStatusId: Id,
    toStatusId: Id,
    roleIds: z.array(Id),
  }))
  .returns(z.promise(WorkflowTransition));

/** Delete a workflow transition rule */
export const DeleteWorkflowTransition = z.function()
  .args(z.object({ transitionId: Id }))
  .returns(z.promise(z.void()));

/** List workflow transitions for a project and issue type */
export const ListWorkflowTransitions = z.function()
  .args(z.object({
    projectId: Id,
    issueTypeId: Id.optional(),
    fromStatusId: Id.optional(),
  }))
  .returns(z.promise(z.object({
    transitions: z.array(WorkflowTransition),
  })));

/** Bulk set workflow transitions (replace all for a project+issueType) */
export const SetWorkflowTransitions = z.function()
  .args(z.object({
    projectId: Id,
    issueTypeId: Id,
    transitions: z.array(z.object({
      fromStatusId: Id,
      toStatusId: Id,
      roleIds: z.array(Id),
    })),
  }))
  .returns(z.promise(z.object({
    transitions: z.array(WorkflowTransition),
  })));
