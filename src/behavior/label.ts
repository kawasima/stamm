import { z } from "zod";
import { HexColor, Id, PaginationParams } from "../schema/common.js";
import { Label } from "../schema/label.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Label CRUD
// ============================================================

/** Create a label in a project */
export const CreateLabel = z.function()
  .args(z.object({
    projectId: Id,
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    color: HexColor,
  }))
  .returns(z.promise(Label));

/** Get a label by ID */
export const GetLabel = z.function()
  .args(z.object({ labelId: Id }))
  .returns(z.promise(Label));

/** Update a label */
export const UpdateLabel = z.function()
  .args(z.object({
    labelId: Id,
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    color: HexColor.optional(),
  }))
  .returns(z.promise(Label));

/** Delete a label */
export const DeleteLabel = z.function()
  .args(z.object({ labelId: Id }))
  .returns(z.promise(z.void()));

/** List labels in a project */
export const ListLabels = z.function()
  .args(z.object({
    projectId: Id,
    query: z.string().optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Label)));
