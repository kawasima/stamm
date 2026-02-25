import { z } from "zod";
import { Id, PaginationParams, SortOrder } from "../schema/common.js";
import {
  CustomFieldDefinition,
  CustomFieldType,
  CustomFieldConstraints,
  CustomFieldScope,
} from "../schema/custom-field.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Custom Field Definition CRUD
// ============================================================

/** Create a custom field definition */
export const CreateCustomFieldDefinition = z.function()
  .args(z.object({
    name: z.string().min(1).max(200),
    fieldType: CustomFieldType,
    description: z.string().max(500).optional(),
    isRequired: z.boolean().optional(),
    defaultValue: z.string().optional(),
    possibleValues: z.array(z.string()).optional(),
    constraints: CustomFieldConstraints,
    scope: CustomFieldScope,
    sortOrder: SortOrder.optional(),
    isFilter: z.boolean().optional(),
    isSearchable: z.boolean().optional(),
  }))
  .returns(z.promise(CustomFieldDefinition));

/** Get a custom field definition by ID */
export const GetCustomFieldDefinition = z.function()
  .args(z.object({ fieldId: Id }))
  .returns(z.promise(CustomFieldDefinition));

/** Update a custom field definition */
export const UpdateCustomFieldDefinition = z.function()
  .args(z.object({
    fieldId: Id,
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(500).optional(),
    isRequired: z.boolean().optional(),
    defaultValue: z.string().optional(),
    possibleValues: z.array(z.string()).optional(),
    constraints: CustomFieldConstraints.optional(),
    scope: CustomFieldScope.optional(),
    sortOrder: SortOrder.optional(),
    isFilter: z.boolean().optional(),
    isSearchable: z.boolean().optional(),
  }))
  .returns(z.promise(CustomFieldDefinition));

/** Delete a custom field definition */
export const DeleteCustomFieldDefinition = z.function()
  .args(z.object({ fieldId: Id }))
  .returns(z.promise(z.void()));

/** List custom field definitions with optional scope filtering */
export const ListCustomFieldDefinitions = z.function()
  .args(z.object({
    projectId: Id.optional(),
    issueTypeId: Id.optional(),
    fieldType: CustomFieldType.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(CustomFieldDefinition)));
