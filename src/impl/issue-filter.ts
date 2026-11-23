import { sql, type RawBuilder } from "kysely";
import type { IssueFilter } from "../schema/index.js";
import { contains, onOrAfter, onOrBefore } from "./listing.js";

/** When the row of `issues` was created, from its timeline (see schema/activity.ts). */
export const createdAt = sql`(select min(occurred_at) from activity_entries ae where ae.target_type = 'issue' and ae.target_id = issues.id and ae.action = 'created')`;
/** When it last changed. */
export const updatedAt = sql`(select max(occurred_at) from activity_entries ae where ae.target_type = 'issue' and ae.target_id = issues.id)`;

const dueDate = sql`(select s.due_date from issue_schedules s where s.issue_id = issues.id)`;
const category = sql`(select st.category from statuses st where st.id = issues.status_id)`;

const among = (by: RawBuilder<unknown>, values: string[]): RawBuilder<boolean> => sql<boolean>`${by} in (${sql.join(values)})`;

/** A row of `table` about the issue has `column` among `values`. */
const linked = (table: string, column: string, values: string[], issueId = "issue_id"): RawBuilder<boolean> =>
  sql<boolean>`exists(select 1 from ${sql.table(table)} l where ${sql.ref(`l.${issueId}`)} = issues.id and ${among(sql.ref(`l.${column}`), values)})`;

/** The issue holds `value` in the field, alone or among several. Types must match: "1" is not 1. */
const hasCustomField = ({ fieldId, value }: { fieldId: string; value: string | number | boolean }): RawBuilder<boolean> => {
  const type = typeof value === "string" ? sql`= 'text'` : typeof value === "number" ? sql`in ('integer', 'real')` : sql`= ${String(value)}`;
  const same = typeof value === "boolean" ? sql`1 = 1` : sql`v.value = ${value}`;
  return sql<boolean>`exists(
    select 1 from json_each(issues.custom_fields) f, json_each(f.value, '$.value') v
    where json_extract(f.value, '$.fieldId') = ${fieldId} and v.type ${type} and ${same})`;
};

/**
 * SQL condition on a row of `issues`: does it match `f`? `today` (UTC) is what
 * overdue is judged by. Says nothing about who may read the issue; that is
 * issueVisible (issue-visibility.ts).
 */
export function issueMatches(f: IssueFilter, today: string): RawBuilder<boolean> {
  const all: RawBuilder<boolean>[] = [sql<boolean>`1 = 1`];
  const col = (name: string) => sql.ref(`issues.${name}`);

  if (f.projectId) all.push(among(col("project_id"), [f.projectId]));
  if (f.projectIds?.length) all.push(among(col("project_id"), f.projectIds));
  if (f.issueTypeIds?.length) all.push(among(col("issue_type_id"), f.issueTypeIds));
  if (f.statusIds?.length) all.push(among(col("status_id"), f.statusIds));
  if (f.priorityIds?.length) all.push(among(col("priority_id"), f.priorityIds));
  if (f.authorId) all.push(among(col("author_id"), [f.authorId]));
  if (f.visibility) all.push(among(col("visibility"), [f.visibility]));
  if (f.statusCategories?.length) all.push(among(category, f.statusCategories));

  if (f.assigneeIds?.length) all.push(linked("issue_assignees", "assignee_id", f.assigneeIds));
  if (f.labelIds?.length) all.push(linked("issue_labels", "label_id", f.labelIds));
  if (f.milestoneId !== undefined) all.push(linked("issue_milestones", "milestone_id", [f.milestoneId]));
  if (f.iterationId !== undefined) all.push(linked("issue_iterations", "iteration_id", [f.iterationId]));
  if (f.categoryId !== undefined) all.push(linked("issue_categories", "category_id", [f.categoryId]));
  if (f.watcherUserId !== undefined) all.push(linked("issue_watchers", "user_id", [f.watcherUserId]));
  if (f.parentIssueId) all.push(linked("issue_parents", "parent_issue_id", [f.parentIssueId], "child_issue_id"));

  if (f.createdAfter) all.push(onOrAfter(createdAt, f.createdAfter));
  if (f.createdBefore) all.push(onOrBefore(createdAt, f.createdBefore));
  if (f.updatedAfter) all.push(onOrAfter(updatedAt, f.updatedAfter));
  if (f.updatedBefore) all.push(onOrBefore(updatedAt, f.updatedBefore));
  if (f.dueDateFrom) all.push(sql<boolean>`${dueDate} >= ${f.dueDateFrom}`);
  if (f.dueDateTo) all.push(sql<boolean>`${dueDate} <= ${f.dueDateTo}`);
  if (f.hasNoDueDate) all.push(sql<boolean>`${dueDate} is null`);
  if (f.isOverdue) all.push(sql<boolean>`${dueDate} < ${today} and ${category} <> 'done'`);
  if (f.query) all.push(contains(col("subject"), f.query));
  if (f.customField) all.push(hasCustomField(f.customField));

  return sql<boolean>`(${sql.join(all, sql` and `)})`;
}
