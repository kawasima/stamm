import type { Kysely } from "kysely";

/**
 * Indexes for hot query paths that previously fell back to full scans. The only
 * index on `issues` was the unique `(project_id, number)`, so filters on
 * status/type/priority/author and the visibility predicate scanned the table;
 * reverse lookups on the satellite junctions (by assignee/label/milestone/
 * iteration/parent/category, not by issue_id) were unindexed; and the activity
 * feed, comment ordering, and time-entry user filter had no supporting index.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // issues — columns used in listIssues filters and the visibility predicate.
  await db.schema.createIndex("issues_status_idx").on("issues").column("status_id").execute();
  await db.schema.createIndex("issues_author_idx").on("issues").column("author_id").execute();
  await db.schema.createIndex("issues_issue_type_idx").on("issues").column("issue_type_id").execute();
  await db.schema.createIndex("issues_priority_idx").on("issues").column("priority_id").execute();
  await db.schema.createIndex("issues_key_idx").on("issues").column("key").execute();

  // Reverse-direction lookups on satellite junctions (the existing unique
  // indexes lead with issue_id, so they can't serve a predicate on the target).
  await db.schema.createIndex("issue_assignees_assignee_idx").on("issue_assignees").column("assignee_id").execute();
  await db.schema.createIndex("issue_labels_label_idx").on("issue_labels").column("label_id").execute();
  await db.schema.createIndex("issue_watchers_user_idx").on("issue_watchers").column("user_id").execute();
  await db.schema.createIndex("issue_milestones_milestone_idx").on("issue_milestones").column("milestone_id").execute();
  await db.schema.createIndex("issue_iterations_iteration_idx").on("issue_iterations").column("iteration_id").execute();
  await db.schema.createIndex("issue_parents_parent_idx").on("issue_parents").column("parent_issue_id").execute();
  await db.schema.createIndex("issue_categories_category_idx").on("issue_categories").column("category_id").execute();

  // activity feed — filtered by project/user, ordered by occurred_at.
  await db.schema.createIndex("activity_entries_project_idx").on("activity_entries").column("project_id").execute();
  await db.schema.createIndex("activity_entries_user_idx").on("activity_entries").column("user_id").execute();

  // comments — filter by issue, order by (occurred_at, id).
  await db.schema.createIndex("comments_issue_occurred_idx").on("comments").columns(["issue_id", "occurred_at", "id"]).execute();

  // time entries — user filter (project/issue already indexed in 0004).
  await db.schema.createIndex("time_entries_user_idx").on("time_entries").column("user_id").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const name of [
    "issues_status_idx", "issues_author_idx", "issues_issue_type_idx", "issues_priority_idx", "issues_key_idx",
    "issue_assignees_assignee_idx", "issue_labels_label_idx", "issue_watchers_user_idx",
    "issue_milestones_milestone_idx", "issue_iterations_iteration_idx", "issue_parents_parent_idx", "issue_categories_category_idx",
    "activity_entries_project_idx", "activity_entries_user_idx",
    "comments_issue_occurred_idx", "time_entries_user_idx",
  ]) {
    await db.schema.dropIndex(name).execute();
  }
}
