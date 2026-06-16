import { z } from "zod";
import { Id, PaginationParams, SortOrder } from "../schema/common.js";
import { IssueFilter } from "../schema/filter.js";
import {
  AutomationActionType,
  AutomationRule,
  AutomationTrigger,
} from "../schema/automation.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Automation Rule CRUD
// ============================================================

/** Create an automation rule */
export const CreateAutomationRule = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id,
    name: z.string().min(1).max(200),
    trigger: AutomationTrigger,
    condition: IssueFilter.optional(),
    actionType: AutomationActionType,
    actionParams: z.record(z.string()).optional(),
    enabled: z.boolean().optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(AutomationRule));

/** Get an automation rule by ID */
export const GetAutomationRule = z.function()
  .args(z.object({ ruleId: Id }))
  .returns(z.promise(AutomationRule));

/** Update an automation rule */
export const UpdateAutomationRule = z.function()
  .args(z.object({
    actorId: Id,
    ruleId: Id,
    name: z.string().min(1).max(200).optional(),
    trigger: AutomationTrigger.optional(),
    condition: IssueFilter.optional(),
    actionType: AutomationActionType.optional(),
    actionParams: z.record(z.string()).optional(),
    enabled: z.boolean().optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(AutomationRule));

/** Delete an automation rule */
export const DeleteAutomationRule = z.function()
  .args(z.object({ actorId: Id, ruleId: Id }))
  .returns(z.promise(z.void()));

/** Enable or disable an automation rule */
export const ToggleAutomationRule = z.function()
  .args(z.object({
    actorId: Id,
    ruleId: Id,
    enabled: z.boolean(),
  }))
  .returns(z.promise(AutomationRule));

/** List automation rules in a project */
export const ListAutomationRules = z.function()
  .args(z.object({
    projectId: Id,
    trigger: AutomationTrigger.optional(),
    enabled: z.boolean().optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(AutomationRule)));
