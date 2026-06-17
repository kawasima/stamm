import { IssueTemplate } from "../../schema/index.js";
import type { IssueTemplate as IssueTemplateT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { assertCanWrite } from "../permissions.js";
import { buildPage, decodeCursor } from "../pagination.js";

type TemplateMethods =
  | "createIssueTemplate" | "getIssueTemplate" | "updateIssueTemplate" | "deleteIssueTemplate"
  | "listIssueTemplates" | "instantiateTemplate";

const JSON_FIELDS = ["defaultLabelIds", "defaultAssigneeIds", "defaultCustomFields"];

/**
 * Issue templates pre-fill a new issue. Writes require `template.manage`; reads
 * are open. {@link instantiateTemplate} is a pure transform — it returns prepared
 * CreateIssue arguments and persists nothing, so the caller drives the actual
 * issue creation (and its permission check).
 */
export function templateBehaviors(ctx: Ctx): Pick<Behaviors, TemplateMethods> {
  const db = ctx.db;
  const codec = makeCodec(IssueTemplate, { json: JSON_FIELDS });

  const load = async (id: string): Promise<IssueTemplateT> => {
    const row = await db.selectFrom("issue_templates").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundError("IssueTemplate", id);
    return codec.decode(row);
  };

  return {
    createIssueTemplate: async (args) => {
      await assertCanWrite(ctx, args.projectId, args.actorId, "template.manage");
      const { actorId: _a, ...fields } = args;
      const template = IssueTemplate.parse({ id: ctx.genId(), ...fields });
      await db.insertInto("issue_templates").values(codec.encode(template) as never).execute();
      return template;
    },

    getIssueTemplate: async ({ templateId }) => load(templateId),

    updateIssueTemplate: async (args) => {
      const template = await load(args.templateId);
      await assertCanWrite(ctx, template.projectId, args.actorId, "template.manage");
      const patch: Record<string, unknown> = {};
      for (const f of ["name", "issueTypeId", "titlePrefix", "descriptionTemplate", "defaultPriorityId", "defaultLabelIds", "defaultAssigneeIds", "defaultCustomFields", "sortOrder"] as const) {
        if ((args as Record<string, unknown>)[f] !== undefined) patch[f] = (args as Record<string, unknown>)[f];
      }
      const merged = IssueTemplate.parse({ ...template, ...patch });
      await db.updateTable("issue_templates").set(codec.encode(merged) as never).where("id", "=", merged.id).execute();
      return merged;
    },

    deleteIssueTemplate: async ({ actorId, templateId }) => {
      const template = await load(templateId);
      await assertCanWrite(ctx, template.projectId, actorId, "template.manage");
      await db.deleteFrom("issue_templates").where("id", "=", templateId).execute();
    },

    listIssueTemplates: async ({ projectId, issueTypeId, pagination }) => {
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("issue_templates").selectAll().where("project_id", "=", projectId);
      if (issueTypeId) q = q.where("issue_type_id", "=", issueTypeId);
      if (cursor) q = q.where("id", ">", cursor);
      const rows = await q.orderBy("id").limit(limit + 1).execute();
      const page = buildPage(rows.map((r) => codec.decode(r)), (t) => t.id, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    instantiateTemplate: async ({ templateId, subject }) => {
      const t = await load(templateId);
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
        ...(t.defaultCustomFields !== undefined ? { customFields: t.defaultCustomFields } : {}),
      };
    },
  };
}
