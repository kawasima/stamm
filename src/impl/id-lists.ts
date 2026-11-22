import type { Kysely } from "kysely";
import type { Ctx } from "./ctx.js";

/**
 * A list of ids that is part of a row: who may make a transition, where a field
 * applies, what a template fills in. Kept as rows, so that each id is a reference the
 * database guards, and put back on the value where it is read.
 */
export interface IdList { table: string; owner: string; member: string }

export const TRANSITION_ROLES: IdList = { table: "workflow_transition_roles", owner: "transition_id", member: "role_id" };
export const FIELD_PROJECTS: IdList = { table: "custom_field_projects", owner: "field_id", member: "project_id" };
export const FIELD_ISSUE_TYPES: IdList = { table: "custom_field_issue_types", owner: "field_id", member: "issue_type_id" };
export const TEMPLATE_LABELS: IdList = { table: "issue_template_labels", owner: "template_id", member: "label_id" };
export const TEMPLATE_ASSIGNEES: IdList = { table: "issue_template_assignees", owner: "template_id", member: "user_id" };

/** The lists of `owners`, in the order they were given. An owner without one is absent. */
export async function readLists(db: Kysely<any>, list: IdList, owners: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (owners.length === 0) return out;
  const rows = await db.selectFrom(list.table).select([`${list.owner} as owner`, `${list.member} as member`]).where(list.owner, "in", owners).orderBy("position").execute();
  for (const r of rows as { owner: string; member: string }[]) out.set(r.owner, [...(out.get(r.owner) ?? []), r.member]);
  return out;
}

/** Replace the list of `owner`. */
export async function writeList(ctx: Ctx, db: Kysely<any>, list: IdList, owner: string, ids: string[] | undefined): Promise<void> {
  await db.deleteFrom(list.table).where(list.owner, "=", owner).execute();
  const rows = [...new Set(ids ?? [])].map((id, position) => ({ id: ctx.genId(), [list.owner]: owner, [list.member]: id, position }));
  if (rows.length > 0) await db.insertInto(list.table).values(rows).execute();
}
