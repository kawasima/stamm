import { z } from "zod";
import { Event, Id, Resource } from "./common.js";

// ============================================================
// Intersection entities between Resources / between Events
// These replace Nullable FKs with INSERT-only records
// ============================================================

// --- Project membership ---

export const ProjectMemberJoin = Event.extend({
  projectId: Id,
  userId: Id,
  roleIds: z.array(Id).min(1),
});

export const ProjectMembership = Resource.extend({
  projectId: Id,
  userId: Id,
  roleIds: z.array(Id).min(1),
});

export const ProjectMemberLeave = Event.extend({
  projectId: Id,
  userId: Id,
});

// --- User group membership ---

export const GroupMemberAdd = Event.extend({
  groupId: Id,
  userId: Id,
});

export const GroupMembership = Resource.extend({
  groupId: Id,
  userId: Id,
});

export const GroupMemberRemove = Event.extend({
  groupId: Id,
  userId: Id,
});

// --- Issue assignment (supports multiple assignees) ---

export const Assignment = Event.extend({
  issueId: Id,
  assigneeId: Id,
  userId: Id,
});

export const Unassignment = Event.extend({
  issueId: Id,
  assigneeId: Id,
  userId: Id,
});

// --- Issue labeling ---

export const Labeling = Event.extend({
  issueId: Id,
  labelId: Id,
  userId: Id,
});

export const IssueLabel = Resource.extend({
  issueId: Id,
  labelId: Id,
});

export const Unlabeling = Event.extend({
  issueId: Id,
  labelId: Id,
  userId: Id,
});

// --- Issue categorization ---

export const Categorization = Event.extend({
  issueId: Id,
  categoryId: Id,
  userId: Id,
});

export const IssueCategory = Resource.extend({
  issueId: Id,
  categoryId: Id,
});

// --- Issue milestone ---

export const MilestoneSetting = Event.extend({
  issueId: Id,
  milestoneId: Id,
  userId: Id,
});

export const IssueMilestone = Resource.extend({
  issueId: Id,
  milestoneId: Id,
});

// --- Issue watching ---

export const Watch = Event.extend({
  issueId: Id,
  userId: Id,
});

export const IssueWatcher = Resource.extend({
  issueId: Id,
  userId: Id,
});

export const Unwatch = Event.extend({
  issueId: Id,
  userId: Id,
});

// --- Issue parent-child ---

export const ParentSetting = Event.extend({
  childIssueId: Id,
  parentIssueId: Id,
  userId: Id,
});

export const IssueParent = Resource.extend({
  childIssueId: Id,
  parentIssueId: Id,
});

// --- Category default assignee ---

export const CategoryDefaultAssignee = Resource.extend({
  categoryId: Id,
  assigneeId: Id,
});

export type ProjectMemberJoin = z.infer<typeof ProjectMemberJoin>;
export type ProjectMembership = z.infer<typeof ProjectMembership>;
export type ProjectMemberLeave = z.infer<typeof ProjectMemberLeave>;
export type GroupMemberAdd = z.infer<typeof GroupMemberAdd>;
export type GroupMembership = z.infer<typeof GroupMembership>;
export type GroupMemberRemove = z.infer<typeof GroupMemberRemove>;
export type Assignment = z.infer<typeof Assignment>;
export type Unassignment = z.infer<typeof Unassignment>;
export type Labeling = z.infer<typeof Labeling>;
export type IssueLabel = z.infer<typeof IssueLabel>;
export type Unlabeling = z.infer<typeof Unlabeling>;
export type Categorization = z.infer<typeof Categorization>;
export type IssueCategory = z.infer<typeof IssueCategory>;
export type MilestoneSetting = z.infer<typeof MilestoneSetting>;
export type IssueMilestone = z.infer<typeof IssueMilestone>;
export type Watch = z.infer<typeof Watch>;
export type IssueWatcher = z.infer<typeof IssueWatcher>;
export type Unwatch = z.infer<typeof Unwatch>;
export type ParentSetting = z.infer<typeof ParentSetting>;
export type IssueParent = z.infer<typeof IssueParent>;
export type CategoryDefaultAssignee = z.infer<typeof CategoryDefaultAssignee>;
