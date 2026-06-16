/**
 * Kysely `Database` interface: the RAW storage shape (snake_case columns, JSON
 * stored as text, booleans as 0/1). Domain types live in `src/schema/` (Zod);
 * `codec.ts` bridges the two at the boundary (Raoh-style decode/encode). Grows
 * one table-group at a time as domains are implemented.
 */

export interface StatusesTable {
  id: string;
  name: string;
  category: string;
  color: string | null;
  description: string | null;
  sort_order: number;
}

export interface RolesTable {
  id: string;
  name: string;
  description: string | null;
  permissions: string; // JSON text: Permission[]
  issues_visibility: string;
  builtin_kind: string | null;
}

export interface PrioritiesTable {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
}

export interface LabelsTable {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  color: string;
}

export interface IssueTypesTable {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  description: string | null;
  kind: string;
  sort_order: number;
}

export interface CategoriesTable {
  id: string;
  project_id: string;
  name: string;
}

export interface UsersTable {
  id: string;
  login: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  language: string;
  kind: string;
}

export interface UserGroupsTable {
  id: string;
  name: string;
  description: string | null;
}

/** Per-user JWT signing credentials. Stores the PUBLIC key only (EdDSA/Ed25519). */
export interface UserCredentialsTable {
  id: string;
  user_id: string;
  key_id: string;
  algorithm: string;
  public_key: string; // JSON text: public JWK
  created_at: string;
  revoked_at: string | null;
}

export interface UserStatusesTable {
  id: string;
  user_id: string;
  status: string;
}

export interface GroupMembershipsTable {
  id: string;
  group_id: string;
  user_id: string;
}

export interface ProjectsTable {
  id: string;
  identifier: string;
  name: string;
  description: string | null;
}

export interface ProjectCategoriesTable {
  id: string;
  project_id: string;
  visibility: string;
  lifecycle: string;
}

export interface ProjectHierarchiesTable {
  id: string;
  parent_project_id: string;
  child_project_id: string;
}

export interface ProjectMembershipsTable {
  id: string;
  project_id: string;
  user_id: string;
}

/** Membership↔role is normalized (not a JSON array) so role-based visibility is expressible in SQL. */
export interface ProjectMembershipRolesTable {
  id: string;
  membership_id: string;
  role_id: string;
}

export interface WorkflowTransitionsTable {
  id: string;
  project_id: string;
  issue_type_id: string;
  from_status_id: string;
  to_status_id: string;
  role_ids: string; // JSON text: Id[]
}

export interface DefaultStatusSettingsTable {
  id: string;
  project_id: string;
  issue_type_id: string;
  status_id: string;
}

export interface IssuesTable {
  id: string;
  key: string;
  number: number;
  project_id: string;
  issue_type_id: string;
  priority_id: string;
  status_id: string;
  subject: string;
  description: string | null;
  author_id: string;
  visibility: string;
  custom_fields: string; // JSON text: CustomFieldValue[]
}

export interface IssueStatusChangesTable {
  id: string;
  issue_id: string;
  from_status_id: string | null;
  to_status_id: string;
  user_id: string;
  occurred_at: string;
}

export interface IssueAssigneesTable { id: string; issue_id: string; assignee_id: string }
export interface IssueLabelsTable { id: string; issue_id: string; label_id: string }
export interface IssueCategoriesTable { id: string; issue_id: string; category_id: string }
export interface IssueMilestonesTable { id: string; issue_id: string; milestone_id: string }
export interface IssueParentsTable { id: string; child_issue_id: string; parent_issue_id: string }
export interface IssueWatchersTable { id: string; issue_id: string; user_id: string }
export interface IssueSchedulesTable { id: string; issue_id: string; start_date: string | null; due_date: string | null }
export interface IssueEstimationsTable { id: string; issue_id: string; estimated_hours: number }
export interface IssueProgressTable { id: string; issue_id: string; done_ratio: number }
export interface IssueIterationsTable { id: string; issue_id: string; iteration_id: string }
export interface IssueRelationsTable {
  id: string;
  issue_id: string;
  related_issue_id: string;
  relation_type: string;
  delay: number | null;
}

export interface MilestonesTable {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  status: string;
  start_date: string | null;
  due_date: string | null;
  release_date: string | null;
  sort_order: number;
}

export interface IterationsTable {
  id: string;
  project_id: string;
  name: string;
  start_date: string;
  end_date: string;
  sort_order: number;
}

export interface CommentsTable {
  id: string;
  occurred_at: string;
  issue_id: string;
  author_id: string;
  body: string;
  visibility: string;
}

export interface AttachmentsTable {
  id: string;
  occurred_at: string;
  target_type: string;
  target_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  author_id: string;
  description: string | null;
  storage_key: string;
}

export interface TimeEntriesTable {
  id: string;
  occurred_at: string;
  project_id: string;
  issue_id: string | null;
  user_id: string;
  activity_id: string;
  hours: number;
  spent_on: string;
  comment: string | null;
}

export interface NotificationsTable {
  id: string;
  recipient_id: string;
  event_type: string;
  project_id: string;
  title: string;
  occurred_at: string;
  target_type: string;
  target_id: string;
}

export interface NotificationReadsTable {
  id: string;
  notification_id: string;
  occurred_at: string;
}

export interface ActivityEntriesTable {
  id: string;
  project_id: string;
  user_id: string;
  action: string;
  changes: string; // JSON text: PropertyChange[]
  occurred_at: string;
  target_type: string;
  target_id: string;
}

export interface Database {
  statuses: StatusesTable;
  priorities: PrioritiesTable;
  labels: LabelsTable;
  issue_types: IssueTypesTable;
  categories: CategoriesTable;
  roles: RolesTable;
  users: UsersTable;
  user_groups: UserGroupsTable;
  user_credentials: UserCredentialsTable;
  user_statuses: UserStatusesTable;
  group_memberships: GroupMembershipsTable;
  projects: ProjectsTable;
  project_categories: ProjectCategoriesTable;
  project_hierarchies: ProjectHierarchiesTable;
  project_memberships: ProjectMembershipsTable;
  project_membership_roles: ProjectMembershipRolesTable;
  workflow_transitions: WorkflowTransitionsTable;
  default_status_settings: DefaultStatusSettingsTable;
  issues: IssuesTable;
  issue_status_changes: IssueStatusChangesTable;
  issue_assignees: IssueAssigneesTable;
  issue_labels: IssueLabelsTable;
  issue_categories: IssueCategoriesTable;
  issue_milestones: IssueMilestonesTable;
  issue_parents: IssueParentsTable;
  issue_watchers: IssueWatchersTable;
  issue_schedules: IssueSchedulesTable;
  issue_estimations: IssueEstimationsTable;
  issue_progress: IssueProgressTable;
  issue_iterations: IssueIterationsTable;
  issue_relations: IssueRelationsTable;
  comments: CommentsTable;
  attachments: AttachmentsTable;
  milestones: MilestonesTable;
  iterations: IterationsTable;
  time_entries: TimeEntriesTable;
  notifications: NotificationsTable;
  notification_reads: NotificationReadsTable;
  activity_entries: ActivityEntriesTable;
}
