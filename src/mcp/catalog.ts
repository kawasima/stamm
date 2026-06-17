import * as B from "../behavior/index.js";
import type { SimpleTool } from "./registry.js";

const RO = { readOnlyHint: true } as const;
const DESTRUCTIVE = { destructiveHint: true } as const;
const IDEM = { idempotentHint: true } as const;

/**
 * Tools that map 1:1 onto a single behavior contract. Config-resource CRUD
 * (status/priority/label/issue_type/category/role/user/group) is intentionally
 * absent here — it is folded into the generic admin_* tools. Issue satellite
 * setters are absent too — they are folded into the compound issue_update tool.
 */
export const SIMPLE_TOOLS: SimpleTool[] = [
  // --- Issue ---
  { name: "issue_get", description: "Get an issue by ID", contract: B.GetIssue, behavior: "getIssue", annotations: RO },
  { name: "issue_get_detail", description: "Get an issue hydrated with its bounded satellites (assignees, labels, watchers, relations, schedule)", contract: B.GetIssueDetail, behavior: "getIssueDetail", annotations: RO },
  { name: "issue_get_by_key", description: "Get an issue by its key (e.g. PROJ-123)", contract: B.GetIssueByKey, behavior: "getIssueByKey", annotations: RO },
  { name: "issue_search", description: "List issues with rich filtering, sorting, and pagination", contract: B.ListIssues, behavior: "listIssues", annotations: RO },
  { name: "issue_children", description: "List child issues (subtasks) of an issue", contract: B.ListChildIssues, behavior: "listChildIssues", annotations: RO },
  { name: "issue_create", description: "Create a new issue (can set assignees, labels, milestone, etc. in one call)", contract: B.CreateIssue, behavior: "createIssue" },
  { name: "issue_delete", description: "Delete an issue", contract: B.DeleteIssue, behavior: "deleteIssue", annotations: DESTRUCTIVE },
  { name: "issue_move", description: "Move an issue to a different project", contract: B.MoveIssue, behavior: "moveIssue", annotations: IDEM },
  { name: "issue_transition", description: "Transition an issue to a new status (respects workflow rules)", contract: B.TransitionIssueStatus, behavior: "transitionIssueStatus", annotations: IDEM },
  { name: "issue_available_transitions", description: "List the statuses an issue may transition to from its current status", contract: B.GetAvailableTransitions, behavior: "getAvailableTransitions", annotations: RO },
  { name: "issue_history", description: "List an issue's status change history", contract: B.ListIssueStatusHistory, behavior: "listIssueStatusHistory", annotations: RO },
  { name: "issue_schedule_history", description: "List an issue's schedule (start/due date) change history", contract: B.ListIssueScheduleHistory, behavior: "listIssueScheduleHistory", annotations: RO },
  { name: "issue_estimation_history", description: "List an issue's estimation change history", contract: B.ListIssueEstimationHistory, behavior: "listIssueEstimationHistory", annotations: RO },
  { name: "issue_watch", description: "Watch an issue", contract: B.WatchIssue, behavior: "watchIssue", annotations: IDEM },
  { name: "issue_unwatch", description: "Stop watching an issue", contract: B.UnwatchIssue, behavior: "unwatchIssue", annotations: IDEM },
  { name: "issue_watchers", description: "List watchers of an issue", contract: B.ListIssueWatchers, behavior: "listIssueWatchers", annotations: RO },

  // --- Issue relations ---
  { name: "issue_relate", description: "Create a relation between two issues", contract: B.CreateIssueRelation, behavior: "createIssueRelation" },
  { name: "issue_unrelate", description: "Delete a relation between two issues", contract: B.DeleteIssueRelation, behavior: "deleteIssueRelation", annotations: DESTRUCTIVE },
  { name: "issue_relations", description: "List relations for an issue", contract: B.ListIssueRelations, behavior: "listIssueRelations", annotations: RO },

  // --- Comments ---
  { name: "comment_add", description: "Add a comment to an issue", contract: B.CreateComment, behavior: "createComment" },
  { name: "comment_get", description: "Get a comment by ID", contract: B.GetComment, behavior: "getComment", annotations: RO },
  { name: "comment_update", description: "Edit a comment", contract: B.UpdateComment, behavior: "updateComment", annotations: IDEM },
  { name: "comment_delete", description: "Delete a comment", contract: B.DeleteComment, behavior: "deleteComment", annotations: DESTRUCTIVE },
  { name: "comment_list", description: "List comments on an issue", contract: B.ListComments, behavior: "listComments", annotations: RO },

  // --- Attachments (metadata/reference only; binary upload is not supported in v1) ---
  { name: "attachment_add", description: "Attach a file reference to an issue (binary upload not supported; pass a stored reference)", contract: B.CreateAttachment, behavior: "createAttachment" },
  { name: "attachment_get", description: "Get an attachment by ID", contract: B.GetAttachment, behavior: "getAttachment", annotations: RO },
  { name: "attachment_delete", description: "Delete an attachment", contract: B.DeleteAttachment, behavior: "deleteAttachment", annotations: DESTRUCTIVE },
  { name: "attachment_list", description: "List attachments on an issue", contract: B.ListAttachments, behavior: "listAttachments", annotations: RO },

  // --- Projects ---
  { name: "project_create", description: "Create a project", contract: B.CreateProject, behavior: "createProject" },
  { name: "project_get", description: "Get a project by ID", contract: B.GetProject, behavior: "getProject", annotations: RO },
  { name: "project_get_by_identifier", description: "Get a project by its identifier", contract: B.GetProjectByIdentifier, behavior: "getProjectByIdentifier", annotations: RO },
  { name: "project_update", description: "Update a project", contract: B.UpdateProject, behavior: "updateProject", annotations: IDEM },
  { name: "project_delete", description: "Delete a project", contract: B.DeleteProject, behavior: "deleteProject", annotations: DESTRUCTIVE },
  { name: "project_list", description: "List projects", contract: B.ListProjects, behavior: "listProjects", annotations: RO },
  { name: "project_archive", description: "Archive a project", contract: B.ArchiveProject, behavior: "archiveProject", annotations: IDEM },
  { name: "project_unarchive", description: "Unarchive a project", contract: B.UnarchiveProject, behavior: "unarchiveProject", annotations: IDEM },
  { name: "project_set_visibility", description: "Set a project's visibility", contract: B.SetProjectVisibility, behavior: "setProjectVisibility", annotations: IDEM },
  { name: "project_set_parent", description: "Set a project's parent", contract: B.SetProjectParent, behavior: "setProjectParent", annotations: IDEM },
  { name: "project_members", description: "List members of a project", contract: B.ListProjectMembers, behavior: "listProjectMembers", annotations: RO },
  { name: "project_member_add", description: "Add a member to a project", contract: B.AddProjectMember, behavior: "addProjectMember" },
  { name: "project_member_update", description: "Update a project member's roles", contract: B.UpdateProjectMember, behavior: "updateProjectMember", annotations: IDEM },
  { name: "project_member_remove", description: "Remove a member from a project", contract: B.RemoveProjectMember, behavior: "removeProjectMember", annotations: DESTRUCTIVE },

  // --- Milestones ---
  { name: "milestone_create", description: "Create a milestone", contract: B.CreateMilestone, behavior: "createMilestone" },
  { name: "milestone_get", description: "Get a milestone by ID", contract: B.GetMilestone, behavior: "getMilestone", annotations: RO },
  { name: "milestone_update", description: "Update a milestone", contract: B.UpdateMilestone, behavior: "updateMilestone", annotations: IDEM },
  { name: "milestone_delete", description: "Delete a milestone", contract: B.DeleteMilestone, behavior: "deleteMilestone", annotations: DESTRUCTIVE },
  { name: "milestone_list", description: "List milestones", contract: B.ListMilestones, behavior: "listMilestones", annotations: RO },
  { name: "milestone_close", description: "Close a milestone", contract: B.CloseMilestone, behavior: "closeMilestone", annotations: IDEM },
  { name: "milestone_reopen", description: "Reopen a milestone", contract: B.ReopenMilestone, behavior: "reopenMilestone", annotations: IDEM },
  { name: "milestone_lock", description: "Lock a milestone", contract: B.LockMilestone, behavior: "lockMilestone", annotations: IDEM },
  { name: "milestone_progress", description: "Get a milestone's progress", contract: B.GetMilestoneProgress, behavior: "getMilestoneProgress", annotations: RO },

  // --- Iterations ---
  { name: "iteration_create", description: "Create an iteration", contract: B.CreateIteration, behavior: "createIteration" },
  { name: "iteration_get", description: "Get an iteration by ID", contract: B.GetIteration, behavior: "getIteration", annotations: RO },
  { name: "iteration_update", description: "Update an iteration", contract: B.UpdateIteration, behavior: "updateIteration", annotations: IDEM },
  { name: "iteration_delete", description: "Delete an iteration", contract: B.DeleteIteration, behavior: "deleteIteration", annotations: DESTRUCTIVE },
  { name: "iteration_list", description: "List iterations", contract: B.ListIterations, behavior: "listIterations", annotations: RO },
  { name: "iteration_progress", description: "Get an iteration's progress", contract: B.GetIterationProgress, behavior: "getIterationProgress", annotations: RO },

  // --- Time entries ---
  { name: "time_log", description: "Log a time entry against an issue", contract: B.CreateTimeEntry, behavior: "createTimeEntry" },
  { name: "time_get", description: "Get a time entry by ID", contract: B.GetTimeEntry, behavior: "getTimeEntry", annotations: RO },
  { name: "time_update", description: "Update a time entry", contract: B.UpdateTimeEntry, behavior: "updateTimeEntry", annotations: IDEM },
  { name: "time_delete", description: "Delete a time entry", contract: B.DeleteTimeEntry, behavior: "deleteTimeEntry", annotations: DESTRUCTIVE },
  { name: "time_list", description: "List time entries", contract: B.ListTimeEntries, behavior: "listTimeEntries", annotations: RO },
  { name: "time_summary", description: "Summarize logged time", contract: B.GetTimeSummary, behavior: "getTimeSummary", annotations: RO },

  // --- Activity (canonical timeline; read-only) ---
  { name: "activity_list", description: "List activity-feed entries (newest first), filterable by project, user, action, target, or time range", contract: B.ListActivities, behavior: "listActivities", annotations: RO },
  { name: "activity_get", description: "Get a single activity entry by ID", contract: B.GetActivity, behavior: "getActivity", annotations: RO },

  // --- Draft issues (board items not yet promoted to real issues) ---
  { name: "draft_create", description: "Create a draft issue on a project board", contract: B.CreateDraftIssue, behavior: "createDraftIssue" },
  { name: "draft_get", description: "Get a draft issue by ID", contract: B.GetDraftIssue, behavior: "getDraftIssue", annotations: RO },
  { name: "draft_update", description: "Update a draft issue", contract: B.UpdateDraftIssue, behavior: "updateDraftIssue", annotations: IDEM },
  { name: "draft_delete", description: "Delete a draft issue", contract: B.DeleteDraftIssue, behavior: "deleteDraftIssue", annotations: DESTRUCTIVE },
  { name: "draft_list", description: "List draft issues in a project", contract: B.ListDraftIssues, behavior: "listDraftIssues", annotations: RO },
  { name: "draft_convert", description: "Promote a draft into a real issue (records the conversion)", contract: B.ConvertDraftToIssue, behavior: "convertDraftToIssue" },

  // --- Issue templates ---
  { name: "template_create", description: "Create an issue template", contract: B.CreateIssueTemplate, behavior: "createIssueTemplate" },
  { name: "template_get", description: "Get an issue template by ID", contract: B.GetIssueTemplate, behavior: "getIssueTemplate", annotations: RO },
  { name: "template_update", description: "Update an issue template", contract: B.UpdateIssueTemplate, behavior: "updateIssueTemplate", annotations: IDEM },
  { name: "template_delete", description: "Delete an issue template", contract: B.DeleteIssueTemplate, behavior: "deleteIssueTemplate", annotations: DESTRUCTIVE },
  { name: "template_list", description: "List issue templates in a project", contract: B.ListIssueTemplates, behavior: "listIssueTemplates", annotations: RO },
  { name: "template_instantiate", description: "Build CreateIssue arguments from a template (does not persist)", contract: B.InstantiateTemplate, behavior: "instantiateTemplate", annotations: RO },

  // --- Saved views & board ordering ---
  { name: "view_create", description: "Create a saved view / query", contract: B.CreateProjectView, behavior: "createProjectView" },
  { name: "view_get", description: "Get a saved view by ID", contract: B.GetProjectView, behavior: "getProjectView", annotations: RO },
  { name: "view_update", description: "Update a saved view", contract: B.UpdateProjectView, behavior: "updateProjectView", annotations: IDEM },
  { name: "view_delete", description: "Delete a saved view", contract: B.DeleteProjectView, behavior: "deleteProjectView", annotations: DESTRUCTIVE },
  { name: "view_list", description: "List saved views in a project (shared plus the viewer's own private ones)", contract: B.ListProjectViews, behavior: "listProjectViews", annotations: RO },
  { name: "board_move", description: "Reorder a card within a board view (provide exactly one of beforeIssueId / afterIssueId / position)", contract: B.MoveIssueOnBoard, behavior: "moveIssueOnBoard", annotations: IDEM },
  { name: "board_positions", description: "List card positions for a board view", contract: B.ListBoardPositions, behavior: "listBoardPositions", annotations: RO },

  // --- Notifications ---
  { name: "notification_list", description: "List notifications for a user", contract: B.ListNotifications, behavior: "listNotifications", annotations: RO },
  { name: "notification_unread_count", description: "Get the unread notification count for a user", contract: B.GetUnreadNotificationCount, behavior: "getUnreadNotificationCount", annotations: RO },
  { name: "notification_read", description: "Mark a notification as read", contract: B.MarkNotificationRead, behavior: "markNotificationRead", annotations: IDEM },
  { name: "notification_read_all", description: "Mark all of a user's notifications as read", contract: B.MarkAllNotificationsRead, behavior: "markAllNotificationsRead", annotations: IDEM },

  // --- Workflow & default status (status config beyond admin CRUD) ---
  { name: "workflow_list", description: "List the workflow transitions defined for a status set", contract: B.ListWorkflowTransitions, behavior: "listWorkflowTransitions", annotations: RO },
  { name: "workflow_set", description: "Replace the set of allowed workflow transitions", contract: B.SetWorkflowTransitions, behavior: "setWorkflowTransitions", annotations: IDEM },
  { name: "status_default_get", description: "Get the default status for a project/type", contract: B.GetDefaultStatus, behavior: "getDefaultStatus", annotations: RO },
  { name: "status_default_set", description: "Set the default status for a project/type", contract: B.SetDefaultStatus, behavior: "setDefaultStatus", annotations: IDEM },

  // --- User & group extras ---
  { name: "user_set_status", description: "Set a user's account status (active/locked/...)", contract: B.SetUserStatus, behavior: "setUserStatus", annotations: IDEM },
  { name: "user_get_status", description: "Get a user's account status", contract: B.GetUserStatus, behavior: "getUserStatus", annotations: RO },
  { name: "group_member_add", description: "Add a user to a group", contract: B.AddGroupMember, behavior: "addGroupMember" },
  { name: "group_member_remove", description: "Remove a user from a group", contract: B.RemoveGroupMember, behavior: "removeGroupMember", annotations: DESTRUCTIVE },
  { name: "group_members", description: "List members of a group", contract: B.ListGroupMembers, behavior: "listGroupMembers", annotations: RO },

  // --- User credentials (JWT signing keys for HTTP auth; admin only) ---
  { name: "user_key_issue", description: "Issue a fresh EdDSA signing keypair for a user; the private key is returned once and never again", contract: B.IssueUserKey, behavior: "issueUserKey" },
  { name: "user_key_revoke", description: "Revoke a user's signing key by its key id", contract: B.RevokeUserKey, behavior: "revokeUserKey", annotations: DESTRUCTIVE },
  { name: "user_key_list", description: "List a user's credential metadata (no signable key material)", contract: B.ListUserKeys, behavior: "listUserKeys", annotations: RO },
];
