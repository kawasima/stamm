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
  regexp: z.string().optional(),
  minLength: z.number().int().optional(),
  maxLength: z.number().int().optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
});

export const CustomFieldScope = z.object({
  projectIds: z.array(Id).optional(),
  issueTypeIds: z.array(Id).optional(),
});

export const CustomFieldDefinition = Resource.extend({
  name: z.string().min(1).max(200),
  fieldType: CustomFieldType,
  description: z.string().max(500).optional(),
  isRequired: z.boolean().default(false),
  defaultValue: z.string().optional(),
  possibleValues: z.array(z.string()).optional(),
  constraints: CustomFieldConstraints,
  scope: CustomFieldScope,
  sortOrder: SortOrder,
  isFilter: z.boolean().default(false),
  isSearchable: z.boolean().default(false),
});

export const CustomFieldValue = z.object({
  fieldId: Id,
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
  ]),
});

export type CustomFieldType = z.infer<typeof CustomFieldType>;
export type CustomFieldConstraints = z.infer<typeof CustomFieldConstraints>;
export type CustomFieldScope = z.infer<typeof CustomFieldScope>;
export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinition>;
export type CustomFieldValue = z.infer<typeof CustomFieldValue>;
