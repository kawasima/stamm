import { z } from "zod";
import { Id, PaginationParams } from "../schema/common.js";
import { Category } from "../schema/category.js";
import { CategoryDefaultAssignee } from "../schema/intersection.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Category CRUD (Redmine-style per-project issue categories)
// ============================================================

/** Create a category in a project */
export const CreateCategory = z.function()
  .args(z.object({
    projectId: Id,
    name: z.string().min(1).max(100),
    defaultAssigneeId: Id.optional(),
  }))
  .returns(z.promise(Category));

/** Get a category by ID */
export const GetCategory = z.function()
  .args(z.object({ categoryId: Id }))
  .returns(z.promise(Category));

/** Update a category */
export const UpdateCategory = z.function()
  .args(z.object({
    categoryId: Id,
    name: z.string().min(1).max(100).optional(),
  }))
  .returns(z.promise(Category));

/** Delete a category */
export const DeleteCategory = z.function()
  .args(z.object({ categoryId: Id }))
  .returns(z.promise(z.void()));

/** List categories in a project */
export const ListCategories = z.function()
  .args(z.object({
    projectId: Id,
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Category)));

// ============================================================
// Category Default Assignee
// ============================================================

/** Set the default assignee for a category */
export const SetCategoryDefaultAssignee = z.function()
  .args(z.object({
    categoryId: Id,
    assigneeId: Id,
  }))
  .returns(z.promise(CategoryDefaultAssignee));

/** Remove the default assignee from a category */
export const RemoveCategoryDefaultAssignee = z.function()
  .args(z.object({ categoryId: Id }))
  .returns(z.promise(z.void()));
