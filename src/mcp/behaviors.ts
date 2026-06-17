import { z } from "zod";
import * as B from "../behavior/index.js";

type Fn<C> = z.infer<C extends z.ZodTypeAny ? C : never>;

/**
 * The implementation surface the MCP layer depends on: one method per behavior
 * contract, typed directly from the contract via `z.infer`. The concrete
 * implementation (in-memory, DB-backed, ...) is supplied at server construction
 * and is out of scope for the MCP projection.
 */
export interface Behaviors {
  // --- Issue ---
  getIssue: Fn<typeof B.GetIssue>;
  getIssueDetail: Fn<typeof B.GetIssueDetail>;
  getIssueByKey: Fn<typeof B.GetIssueByKey>;
  listIssues: Fn<typeof B.ListIssues>;
  listChildIssues: Fn<typeof B.ListChildIssues>;
  createIssue: Fn<typeof B.CreateIssue>;
  updateIssue: Fn<typeof B.UpdateIssue>;
  deleteIssue: Fn<typeof B.DeleteIssue>;
  moveIssue: Fn<typeof B.MoveIssue>;
  transitionIssueStatus: Fn<typeof B.TransitionIssueStatus>;
  getAvailableTransitions: Fn<typeof B.GetAvailableTransitions>;
  listIssueStatusHistory: Fn<typeof B.ListIssueStatusHistory>;
  watchIssue: Fn<typeof B.WatchIssue>;
  unwatchIssue: Fn<typeof B.UnwatchIssue>;
  listIssueWatchers: Fn<typeof B.ListIssueWatchers>;

  // Satellite setters (folded into the compound issue_update tool)
  setIssueAssignees: Fn<typeof B.SetIssueAssignees>;
  setIssueLabels: Fn<typeof B.SetIssueLabels>;
  setIssueCategory: Fn<typeof B.SetIssueCategory>;
  setIssueMilestone: Fn<typeof B.SetIssueMilestone>;
  setIssueParent: Fn<typeof B.SetIssueParent>;
  setIssueSchedule: Fn<typeof B.SetIssueSchedule>;
  setIssueEstimation: Fn<typeof B.SetIssueEstimation>;
  setIssueProgress: Fn<typeof B.SetIssueProgress>;
  setIssueIteration: Fn<typeof B.SetIssueIteration>;

  // --- Issue relations ---
  createIssueRelation: Fn<typeof B.CreateIssueRelation>;
  deleteIssueRelation: Fn<typeof B.DeleteIssueRelation>;
  listIssueRelations: Fn<typeof B.ListIssueRelations>;

  // --- Comments ---
  createComment: Fn<typeof B.CreateComment>;
  getComment: Fn<typeof B.GetComment>;
  updateComment: Fn<typeof B.UpdateComment>;
  deleteComment: Fn<typeof B.DeleteComment>;
  listComments: Fn<typeof B.ListComments>;

  // --- Attachments ---
  createAttachment: Fn<typeof B.CreateAttachment>;
  getAttachment: Fn<typeof B.GetAttachment>;
  deleteAttachment: Fn<typeof B.DeleteAttachment>;
  listAttachments: Fn<typeof B.ListAttachments>;

  // --- Projects ---
  createProject: Fn<typeof B.CreateProject>;
  getProject: Fn<typeof B.GetProject>;
  getProjectByIdentifier: Fn<typeof B.GetProjectByIdentifier>;
  updateProject: Fn<typeof B.UpdateProject>;
  deleteProject: Fn<typeof B.DeleteProject>;
  listProjects: Fn<typeof B.ListProjects>;
  archiveProject: Fn<typeof B.ArchiveProject>;
  unarchiveProject: Fn<typeof B.UnarchiveProject>;
  setProjectVisibility: Fn<typeof B.SetProjectVisibility>;
  setProjectParent: Fn<typeof B.SetProjectParent>;
  listProjectMembers: Fn<typeof B.ListProjectMembers>;
  addProjectMember: Fn<typeof B.AddProjectMember>;
  updateProjectMember: Fn<typeof B.UpdateProjectMember>;
  removeProjectMember: Fn<typeof B.RemoveProjectMember>;

  // --- Milestones ---
  createMilestone: Fn<typeof B.CreateMilestone>;
  getMilestone: Fn<typeof B.GetMilestone>;
  updateMilestone: Fn<typeof B.UpdateMilestone>;
  deleteMilestone: Fn<typeof B.DeleteMilestone>;
  listMilestones: Fn<typeof B.ListMilestones>;
  closeMilestone: Fn<typeof B.CloseMilestone>;
  reopenMilestone: Fn<typeof B.ReopenMilestone>;
  lockMilestone: Fn<typeof B.LockMilestone>;
  getMilestoneProgress: Fn<typeof B.GetMilestoneProgress>;

  // --- Iterations ---
  createIteration: Fn<typeof B.CreateIteration>;
  getIteration: Fn<typeof B.GetIteration>;
  updateIteration: Fn<typeof B.UpdateIteration>;
  deleteIteration: Fn<typeof B.DeleteIteration>;
  listIterations: Fn<typeof B.ListIterations>;
  getIterationProgress: Fn<typeof B.GetIterationProgress>;

  // --- Time entries ---
  createTimeEntry: Fn<typeof B.CreateTimeEntry>;
  getTimeEntry: Fn<typeof B.GetTimeEntry>;
  updateTimeEntry: Fn<typeof B.UpdateTimeEntry>;
  deleteTimeEntry: Fn<typeof B.DeleteTimeEntry>;
  listTimeEntries: Fn<typeof B.ListTimeEntries>;
  getTimeSummary: Fn<typeof B.GetTimeSummary>;

  // --- Activity (canonical timeline; read-only) ---
  listActivities: Fn<typeof B.ListActivities>;
  getActivity: Fn<typeof B.GetActivity>;

  // --- Draft issues ---
  createDraftIssue: Fn<typeof B.CreateDraftIssue>;
  getDraftIssue: Fn<typeof B.GetDraftIssue>;
  updateDraftIssue: Fn<typeof B.UpdateDraftIssue>;
  deleteDraftIssue: Fn<typeof B.DeleteDraftIssue>;
  listDraftIssues: Fn<typeof B.ListDraftIssues>;
  convertDraftToIssue: Fn<typeof B.ConvertDraftToIssue>;

  // --- Issue templates ---
  createIssueTemplate: Fn<typeof B.CreateIssueTemplate>;
  getIssueTemplate: Fn<typeof B.GetIssueTemplate>;
  updateIssueTemplate: Fn<typeof B.UpdateIssueTemplate>;
  deleteIssueTemplate: Fn<typeof B.DeleteIssueTemplate>;
  listIssueTemplates: Fn<typeof B.ListIssueTemplates>;
  instantiateTemplate: Fn<typeof B.InstantiateTemplate>;

  // --- Saved views & board ordering ---
  createProjectView: Fn<typeof B.CreateProjectView>;
  getProjectView: Fn<typeof B.GetProjectView>;
  updateProjectView: Fn<typeof B.UpdateProjectView>;
  deleteProjectView: Fn<typeof B.DeleteProjectView>;
  listProjectViews: Fn<typeof B.ListProjectViews>;
  moveIssueOnBoard: Fn<typeof B.MoveIssueOnBoard>;
  listBoardPositions: Fn<typeof B.ListBoardPositions>;

  // --- Notifications ---
  listNotifications: Fn<typeof B.ListNotifications>;
  getUnreadNotificationCount: Fn<typeof B.GetUnreadNotificationCount>;
  markNotificationRead: Fn<typeof B.MarkNotificationRead>;
  markAllNotificationsRead: Fn<typeof B.MarkAllNotificationsRead>;

  // --- Workflow & status config (status extras beyond admin CRUD) ---
  listWorkflowTransitions: Fn<typeof B.ListWorkflowTransitions>;
  setWorkflowTransitions: Fn<typeof B.SetWorkflowTransitions>;
  getDefaultStatus: Fn<typeof B.GetDefaultStatus>;
  setDefaultStatus: Fn<typeof B.SetDefaultStatus>;

  // --- User & group extras ---
  setUserStatus: Fn<typeof B.SetUserStatus>;
  getUserStatus: Fn<typeof B.GetUserStatus>;
  addGroupMember: Fn<typeof B.AddGroupMember>;
  removeGroupMember: Fn<typeof B.RemoveGroupMember>;
  listGroupMembers: Fn<typeof B.ListGroupMembers>;

  // --- User credentials (JWT signing keys) ---
  issueUserKey: Fn<typeof B.IssueUserKey>;
  revokeUserKey: Fn<typeof B.RevokeUserKey>;
  listUserKeys: Fn<typeof B.ListUserKeys>;

  // --- Config resources (admin_* generic CRUD) ---
  createStatus: Fn<typeof B.CreateStatus>;
  getStatus: Fn<typeof B.GetStatus>;
  updateStatus: Fn<typeof B.UpdateStatus>;
  deleteStatus: Fn<typeof B.DeleteStatus>;
  listStatuses: Fn<typeof B.ListStatuses>;

  createPriority: Fn<typeof B.CreatePriority>;
  getPriority: Fn<typeof B.GetPriority>;
  updatePriority: Fn<typeof B.UpdatePriority>;
  deletePriority: Fn<typeof B.DeletePriority>;
  listPriorities: Fn<typeof B.ListPriorities>;

  createLabel: Fn<typeof B.CreateLabel>;
  getLabel: Fn<typeof B.GetLabel>;
  updateLabel: Fn<typeof B.UpdateLabel>;
  deleteLabel: Fn<typeof B.DeleteLabel>;
  listLabels: Fn<typeof B.ListLabels>;

  createIssueType: Fn<typeof B.CreateIssueType>;
  getIssueType: Fn<typeof B.GetIssueType>;
  updateIssueType: Fn<typeof B.UpdateIssueType>;
  deleteIssueType: Fn<typeof B.DeleteIssueType>;
  listIssueTypes: Fn<typeof B.ListIssueTypes>;

  createCategory: Fn<typeof B.CreateCategory>;
  getCategory: Fn<typeof B.GetCategory>;
  updateCategory: Fn<typeof B.UpdateCategory>;
  deleteCategory: Fn<typeof B.DeleteCategory>;
  listCategories: Fn<typeof B.ListCategories>;

  createRole: Fn<typeof B.CreateRole>;
  getRole: Fn<typeof B.GetRole>;
  updateRole: Fn<typeof B.UpdateRole>;
  deleteRole: Fn<typeof B.DeleteRole>;
  listRoles: Fn<typeof B.ListRoles>;

  createUser: Fn<typeof B.CreateUser>;
  getUser: Fn<typeof B.GetUser>;
  updateUser: Fn<typeof B.UpdateUser>;
  deleteUser: Fn<typeof B.DeleteUser>;
  listUsers: Fn<typeof B.ListUsers>;

  createUserGroup: Fn<typeof B.CreateUserGroup>;
  getUserGroup: Fn<typeof B.GetUserGroup>;
  updateUserGroup: Fn<typeof B.UpdateUserGroup>;
  deleteUserGroup: Fn<typeof B.DeleteUserGroup>;
  listUserGroups: Fn<typeof B.ListUserGroups>;
}
