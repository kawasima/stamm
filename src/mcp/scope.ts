import type { KeyScope } from "../schema/index.js";

/**
 * Tools a project-limited key may call. This is an allowlist on purpose: every
 * entry here has been checked to resolve its project (or issue) through the
 * scope-aware permission layer, or filters its own listing by scope. A tool not
 * listed is hidden and refused for such a key, so a newly added tool is denied
 * until someone has audited it.
 *
 * Left out deliberately: attachments (non-issue targets skip the read check),
 * notifications (not filtered by project), templates and workflow reads (no
 * project check), issue_move (crosses projects), and every global/admin tool.
 */
export const PROJECT_SCOPED_TOOLS: ReadonlySet<string> = new Set([
  "issue_get", "issue_get_detail", "issue_get_by_key", "issue_search", "issue_children",
  "issue_available_transitions", "issue_history", "issue_schedule_history", "issue_estimation_history",
  "issue_watchers", "issue_relations",
  "issue_create", "issue_update", "issue_delete", "issue_transition", "issue_watch", "issue_unwatch",
  "issue_relate", "issue_unrelate",
  "comment_add", "comment_get", "comment_list", "comment_update", "comment_delete",
  "project_get", "project_get_by_identifier", "project_list", "project_members",
  "milestone_get", "milestone_list", "milestone_progress",
  "iteration_get", "iteration_list", "iteration_progress",
  "time_get", "time_list", "time_summary", "time_log", "time_update", "time_delete",
  "activity_list", "activity_get",
]);

/** Whether a key with `scope` may use the tool `name`. `readOnly` is the tool's own read-only flag. */
export function toolAllowed(scope: KeyScope | undefined, name: string, readOnly: boolean): boolean {
  if (!scope) return true;
  if (scope.readOnly && !readOnly) return false;
  if (scope.projectIds && !PROJECT_SCOPED_TOOLS.has(name)) return false;
  return true;
}
