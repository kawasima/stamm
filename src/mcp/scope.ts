import type { KeyScope } from "../schema/index.js";

/**
 * Tools a project-limited key may call. This is an allowlist on purpose: every
 * entry here has been checked to resolve its project (or issue) through the
 * scope-aware permission layer, or filters its own listing by scope. A tool not
 * listed is hidden and refused for such a key, so a newly added tool is denied
 * until someone has audited it.
 *
 * Left out deliberately: attachments (no such key has needed them), issue_move (crosses projects), and every global/admin write. Of the admin_*
 * tools, only reads of {@link PROJECT_SCOPED_RESOURCES} are open.
 */
export const PROJECT_SCOPED_TOOLS: ReadonlySet<string> = new Set([
  "issue_get", "issue_get_detail", "issue_get_by_key", "issue_search", "issue_children",
  "issue_available_transitions", "issue_change_list", "issue_history", "issue_schedule_history", "issue_estimation_history",
  "issue_watchers", "issue_relations",
  "issue_create", "issue_update", "issue_delete", "issue_transition", "issue_watch", "issue_unwatch",
  "issue_relate", "issue_unrelate",
  "comment_add", "comment_get", "comment_list", "comment_update", "comment_delete",
  "project_get", "project_get_by_identifier", "project_list", "project_members",
  "milestone_get", "milestone_list", "milestone_progress",
  "iteration_get", "iteration_list", "iteration_progress",
  "time_get", "time_list", "time_summary", "time_log", "time_update", "time_delete",
  "activity_list", "activity_get",
  "workflow_list", "status_default_get", "template_get", "template_list", "template_instantiate",
  // A notification inbox is the key user's own and is filtered by the key's projects.
  "notification_list", "notification_unread_count", "notification_read", "notification_read_all",
]);

/** Whether a key with `scope` may use the tool `name`. `readOnly` is the tool's own read-only flag. */
export function toolAllowed(scope: KeyScope | undefined, name: string, readOnly: boolean): boolean {
  if (!scope) return true;
  if (scope.readOnly && !readOnly) return false;
  if (scope.projectIds && !PROJECT_SCOPED_TOOLS.has(name)) return false;
  return true;
}

/**
 * Config resources a project-limited key may read: the shared vocabulary an issue
 * is written in, and rows the permission layer narrows to the key's projects.
 * Roles and groups are left out because they describe people across projects.
 */
const PROJECT_SCOPED_RESOURCES: ReadonlySet<string> = new Set([
  "status", "priority", "issue_type", "label", "category", "custom_field", "user",
]);

/** The resources an admin_* tool may serve under `scope`; none means the tool is not offered. */
export function allowedResources(scope: KeyScope | undefined, readOnly: boolean, resources: string[]): string[] {
  if (!scope) return resources;
  if ((scope.readOnly || scope.projectIds) && !readOnly) return [];
  return scope.projectIds ? resources.filter((r) => PROJECT_SCOPED_RESOURCES.has(r)) : resources;
}
