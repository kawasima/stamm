import type { Kysely } from "kysely";
import { ValidationError } from "./errors.js";

/**
 * Rules between references that a foreign key can't state. That a referenced row
 * exists is the database's business (migration 0015); these say it is the right one.
 */

type Owned = "labels" | "categories" | "milestones" | "iterations" | "issues";

/** What is attached to an issue (or logged on one) belongs to the issue's project. */
export async function assertInProject(db: Kysely<any>, projectId: string, table: Owned, ids: (string | undefined)[]): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== undefined))];
  if (wanted.length === 0) return;
  const rows = await db.selectFrom(table).select("id").where("project_id", "=", projectId).where("id", "in", wanted).execute();
  const found = new Set(rows.map((r) => r.id as string));
  // One message for "elsewhere" and "nowhere": the caller may not see the other project.
  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length > 0) throw new ValidationError(`No such ${table} in this project: ${missing.join(", ")}`);
}

/** `child` may not be its own ancestor. Call inside the transaction that writes the link. */
export async function assertNoCycle(
  db: Kysely<any>,
  link: { table: string; child: string; parent: string },
  childId: string,
  parentId: string,
): Promise<void> {
  const seen = new Set<string>();
  for (let at: string | undefined = parentId; at !== undefined && !seen.has(at); ) {
    if (at === childId) throw new ValidationError("It can't be placed under itself or something below it");
    seen.add(at);
    const row: Record<string, unknown> | undefined = await db.selectFrom(link.table).select(link.parent).where(link.child, "=", at).executeTakeFirst();
    at = row?.[link.parent] as string | undefined;
  }
}

/** What an issue has that belongs to its project, for when it leaves. */
export const PROJECT_ATTACHMENTS = ["issue_labels", "issue_categories", "issue_milestones", "issue_iterations"] as const;
