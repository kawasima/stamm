import { z } from "zod";
import { HexColor, Id, PaginationParams, SortOrder } from "../schema/common.js";
import { Priority } from "../schema/priority.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Priority CRUD
// ============================================================

/** Create a priority */
export const CreatePriority = z.function()
  .args(z.object({
    actorId: Id,
    name: z.string().min(1).max(100),
    color: HexColor.optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(Priority));

/** Get a priority by ID */
export const GetPriority = z.function()
  .args(z.object({ priorityId: Id }))
  .returns(z.promise(Priority));

/** Update a priority */
export const UpdatePriority = z.function()
  .args(z.object({
    actorId: Id,
    priorityId: Id,
    name: z.string().min(1).max(100).optional(),
    color: HexColor.optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(Priority));

/** Delete a priority */
export const DeletePriority = z.function()
  .args(z.object({ actorId: Id, priorityId: Id }))
  .returns(z.promise(z.void()));

/** List all priorities */
export const ListPriorities = z.function()
  .args(z.object({ pagination: PaginationParams }))
  .returns(z.promise(PaginatedResult(Priority)));
