import { sql } from "kysely";
import { IssueTemplate } from "../../schema/index.js";
import type { IssueTemplate as IssueTemplateT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { assertAssignable, assertCanReadProject, assertCanWrite, canReadProject } from "../permissions.js";
import { asMissing } from "../issue-visibility.js";
import { readLists, TEMPLATE_ASSIGNEES, TEMPLATE_LABELS, writeList } from "../id-lists.js";
import { assertInProject } from "../references.js";
import { inTransaction } from "../tx.js";
import { applicableValues } from "./custom-field.js";
import { listPage } from "../listing.js";

type TemplateMethods =
  | "createIssueTemplate" | "getIssueTemplate" | "updateIssueTemplate" | "deleteIssueTemplate"
  | "listIssueTemplates" | "instantiateTemplate";

const JSON_FIELDS = ["defaultCustomFields"];

/**
 * Issue templates pre-fill a new issue. Writes require `template.manage`; reads
 * require the project to be readable. {@link instantiateTemplate} is a pure transform — it returns prepared
 * CreateIssue arguments and persists nothing, so the caller drives the actual
 * issue creation (and its permission check).
 */
export function templateBehaviors(ctx: Ctx): Pick<Behaviors, TemplateMethods> {
  const db = ctx.db;
  const codec = makeCodec(IssueTemplate, { json: JSON_FIELDS });

  const withLists = async (rows: { id: string }[]): Promise<IssueTemplateT[]> => {
    const ids = rows.map((r) => r.id);
    const labels = await readLists(db, TEMPLATE_LABELS, ids);
    const people = await readLists(db, TEMPLATE_ASSIGNEES, ids);
    return rows.map((r) => codec.decode({ ...r, default_label_ids: labels.get(r.id), default_assignee_ids: people.get(r.id) }));
  };
  const rowOf = (t: IssueTemplateT): Record<string, unknown> => {
    const { default_label_ids: _l, default_assignee_ids: _a, ...row } = codec.encode(t);
    return row;
  };
  const writeLists = async (trx: typeof db, t: IssueTemplateT): Promise<void> => {
    await writeList(ctx, trx, TEMPLATE_LABELS, t.id, t.defaultLabelIds);
    await writeList(ctx, trx, TEMPLATE_ASSIGNEES, t.id, t.defaultAssigneeIds);
  };

  const load = async (id: string): Promise<IssueTemplateT> => {
    const row = await db.selectFrom("issue_templates").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundError("IssueTemplate", id);
    return (await withLists([row]))[0]!;
  };

  /** What a template fills in must be usable where it is used, when it is written. */
  const assertUsable = async (t: IssueTemplateT): Promise<void> => {
    await assertInProject(db, t.projectId, "labels", t.defaultLabelIds ?? []);
    await assertAssignable(ctx, t.projectId, t.defaultAssigneeIds ?? []);
    const values = t.defaultCustomFields ?? [];
    const usable = new Set((await applicableValues(ctx, t.projectId, t.issueTypeId, values)).map((v) => v.fieldId));
    const bad = values.filter((v) => !usable.has(v.fieldId)).map((v) => v.fieldId);
    if (bad.length > 0) throw new ValidationError(`Not a usable custom field or value here: ${bad.join(", ")}`);
  };

  /** Load for a reader: a template of an unreadable project is absent, not forbidden. */
  const loadFor = async (actorId: string, id: string): Promise<IssueTemplateT> => {
    const template = await load(id);
    if (!(await canReadProject(ctx, template.projectId, actorId))) throw new NotFoundError("IssueTemplate", id);
    return template;
  };

  return {
    createIssueTemplate: async (args) => {
      await assertCanWrite(ctx, args.projectId, args.actorId, "template.manage");
      const { actorId: _a, ...fields } = args;
      const template = IssueTemplate.parse({ id: ctx.genId(), ...fields });
      await assertUsable(template);
      await inTransaction(db, async (trx) => {
        await trx.insertInto("issue_templates").values(rowOf(template) as never).execute();
        await writeLists(trx, template);
      });
      return template;
    },

    getIssueTemplate: async ({ actorId, templateId }) => loadFor(actorId, templateId),

    updateIssueTemplate: async (args) => {
      const template = await load(args.templateId);
      await asMissing("IssueTemplate", template.id, () => assertCanWrite(ctx, template.projectId, args.actorId, "template.manage"));
      const patch: Record<string, unknown> = {};
      for (const f of ["name", "issueTypeId", "titlePrefix", "descriptionTemplate", "defaultPriorityId", "defaultLabelIds", "defaultAssigneeIds", "defaultCustomFields", "sortOrder"] as const) {
        if ((args as Record<string, unknown>)[f] !== undefined) patch[f] = (args as Record<string, unknown>)[f];
      }
      const merged = IssueTemplate.parse({ ...template, ...patch });
      await assertUsable(merged);
      await inTransaction(db, async (trx) => {
        await trx.updateTable("issue_templates").set(rowOf(merged) as never).where("id", "=", merged.id).execute();
        await writeLists(trx, merged);
      });
      return merged;
    },

    deleteIssueTemplate: async ({ actorId, templateId }) => {
      const template = await load(templateId);
      await asMissing("IssueTemplate", template.id, () => assertCanWrite(ctx, template.projectId, actorId, "template.manage"));
      await db.deleteFrom("issue_templates").where("id", "=", templateId).execute();
    },

    listIssueTemplates: async ({ actorId, projectId, issueTypeId, pagination }) => {
      await assertCanReadProject(ctx, projectId, actorId);
      let q = db.selectFrom("issue_templates").selectAll().where("project_id", "=", projectId);
      if (issueTypeId) q = q.where("issue_type_id", "=", issueTypeId);
      const page = await listPage(q, { name: "templates", keys: [{ by: sql.ref("sort_order"), dir: "asc" }] }, "id", pagination);
      return { items: await withLists(page.items as { id: string }[]), nextCursor: page.nextCursor };
    },

    instantiateTemplate: async ({ actorId, templateId, subject }) => {
      const t = await loadFor(actorId, templateId);
      // Labels and assignees go from a template as they go from the project. A field may
      // have changed since; offer only values that still apply.
      const customFields = t.defaultCustomFields && (await applicableValues(ctx, t.projectId, t.issueTypeId, t.defaultCustomFields));
      // titlePrefix is a prefix to the caller's subject; fall back to the template
      // name so the result is never an empty subject.
      const finalSubject = t.titlePrefix ? `${t.titlePrefix}${subject ?? ""}` : (subject ?? t.name);
      return {
        projectId: t.projectId,
        ...(t.issueTypeId !== undefined ? { issueTypeId: t.issueTypeId } : {}),
        subject: finalSubject,
        description: t.descriptionTemplate,
        ...(t.defaultPriorityId !== undefined ? { priorityId: t.defaultPriorityId } : {}),
        ...(t.defaultLabelIds !== undefined ? { labelIds: t.defaultLabelIds } : {}),
        ...(t.defaultAssigneeIds !== undefined ? { assigneeIds: t.defaultAssigneeIds } : {}),
        ...(customFields !== undefined ? { customFields } : {}),
      };
    },
  };
}
