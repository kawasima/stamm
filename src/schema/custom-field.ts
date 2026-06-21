import { z } from "zod";
import { Id, Resource, SortOrder } from "./common.js";

export const CustomFieldType = z.enum([
  "string",
  "text",
  "integer",
  "float",
  "boolean",
  "date",
  "list",
  "multi_list",
  "user",
  "version",
  "url",
]);

export const CustomFieldConstraints = z.object({
  // Capped: this pattern is compiled with `new RegExp` and run against issue
  // values, so an unbounded pattern is a ReDoS lever. A short cap, combined with
  // the bounded value length below, keeps backtracking finite.
  regexp: z.string().max(500).optional(),
  minLength: z.number().int().optional(),
  maxLength: z.number().int().optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
});

export const CustomFieldScope = z.object({
  projectIds: z.array(Id).max(500).optional(),
  issueTypeIds: z.array(Id).max(500).optional(),
});

export const CustomFieldDefinition = Resource.extend({
  name: z.string().min(1).max(200),
  fieldType: CustomFieldType,
  description: z.string().max(500).optional(),
  isRequired: z.boolean().default(false),
  defaultValue: z.string().max(10_000).optional(),
  possibleValues: z.array(z.string().max(1_000)).max(1_000).optional(),
  constraints: CustomFieldConstraints,
  scope: CustomFieldScope,
  sortOrder: SortOrder,
  isFilter: z.boolean().default(false),
  isSearchable: z.boolean().default(false),
});

export const CustomFieldValue = z.object({
  fieldId: Id,
  value: z.union([
    z.string().max(10_000),
    z.number(),
    z.boolean(),
    z.array(z.string().max(10_000)).max(1_000),
  ]),
});

export type CustomFieldType = z.infer<typeof CustomFieldType>;
export type CustomFieldConstraints = z.infer<typeof CustomFieldConstraints>;
export type CustomFieldScope = z.infer<typeof CustomFieldScope>;
export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinition>;
export type CustomFieldValue = z.infer<typeof CustomFieldValue>;
