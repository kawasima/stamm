import { z } from "zod";
import { HexColor, Id, Resource, SortOrder } from "./common.js";

// isClosed removed: use category === "done" instead
export const StatusCategory = z.enum(["todo", "in_progress", "done"]);

export const Status = Resource.extend({
  name: z.string().min(1).max(100),
  category: StatusCategory,
  color: HexColor.optional(),
  description: z.string().max(500).optional(),
  sortOrder: SortOrder,
});

export const WorkflowTransition = Resource.extend({
  projectId: Id,
  issueTypeId: Id,
  fromStatusId: Id,
  toStatusId: Id,
  roleIds: z.array(Id),
});

/**
 * Default status (R) - the initial status a new issue gets, per project + type.
 * Replaces the old hard-coded "open" default.
 */
export const DefaultStatusSetting = Resource.extend({
  projectId: Id,
  issueTypeId: Id,
  statusId: Id,
});

export type StatusCategory = z.infer<typeof StatusCategory>;
export type Status = z.infer<typeof Status>;
export type WorkflowTransition = z.infer<typeof WorkflowTransition>;
export type DefaultStatusSetting = z.infer<typeof DefaultStatusSetting>;
