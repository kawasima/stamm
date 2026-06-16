import { z } from "zod";
import { Id, MarkdownContent, Resource, SortOrder } from "./common.js";
import { CustomFieldValue } from "./custom-field.js";

// ============================================================
// Issue Templates (GitHub issue templates / Backlog templates)
//
// A template is configuration content used to pre-fill a new issue. The
// optional fields are template payload (defaults to copy), not relationship
// FKs awaiting a later UPDATE, so optionality is appropriate here.
// ============================================================

export const IssueTemplate = Resource.extend({
  projectId: Id,
  name: z.string().min(1).max(200),
  issueTypeId: Id.optional(),
  titlePrefix: z.string().max(200).optional(),
  descriptionTemplate: MarkdownContent,
  defaultPriorityId: Id.optional(),
  defaultLabelIds: z.array(Id).optional(),
  defaultAssigneeIds: z.array(Id).optional(),
  defaultCustomFields: z.array(CustomFieldValue).optional(),
  sortOrder: SortOrder,
});

export type IssueTemplate = z.infer<typeof IssueTemplate>;
