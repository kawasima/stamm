import { IssueTemplate } from "../../schema/index.js";
import type { IssueTemplate as IssueTemplateT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { assertCanReadProject, assertCanWrite, canReadProject } from "../permissions.js";
import { buildPage, decodeCursor } from "../pagination.js";

type TemplateMethods =
  | "createIssueTemplate" | "getIssueTemplate" | "updateIssueTemplate" | "deleteIssueTemplate"
  | "listIssueTemplates" | "instantiateTemplate";

const JSON_FIELDS = ["defaultLabelIds", "defaultAssigneeIds", "defaultCustomFields"];

/**
 * Issue templates pre-fill a new issue. Writes require `template.manage`; reads
 * require the project to be readable. {@link instantiateTemplate} is a pure transform — it returns prepared
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
      await db.insertInto("issue_templates").values(codec.encode(template) as never).execute();
      return template;
    },

    getIssueTemplate: async ({ actorId, templateId }) => loadFor(actorId, templateId),

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

    listIssueTemplates: async ({ actorId, projectId, issueTypeId, pagination }) => {
      await assertCanReadProject(ctx, projectId, actorId);
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("issue_templates").selectAll().where("project_id", "=", projectId);
      if (issueTypeId) q = q.where("issue_type_id", "=", issueTypeId);
      if (cursor) q = q.where("id", ">", cursor);
      const rows = await q.orderBy("id").limit(limit + 1).execute();
      const page = buildPage(rows.map((r) => codec.decode(r)), (t) => t.id, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    instantiateTemplate: async ({ actorId, templateId, subject }) => {
      const t = await loadFor(actorId, templateId);
      // A template outlives what it names; offer only what can still be used.
      const labels = t.defaultLabelIds?.length
        ? new Set((await db.selectFrom("labels").select("id").where("project_id", "=", t.projectId).where("id", "in", t.defaultLabelIds).execute()).map((r) => r.id))
        : new Set<string>();
      const members = t.defaultAssigneeIds?.length
        ? new Set((await db.selectFrom("project_memberships").select("user_id").where("project_id", "=", t.projectId).where("user_id", "in", t.defaultAssigneeIds).execute()).map((r) => r.user_id))
        : new Set<string>();
      // titlePrefix is a prefix to the caller's subject; fall back to the template
      // name so the result is never an empty subject.
      const finalSubject = t.titlePrefix ? `${t.titlePrefix}${subject ?? ""}` : (subject ?? t.name);
      return {
        projectId: t.projectId,
        ...(t.issueTypeId !== undefined ? { issueTypeId: t.issueTypeId } : {}),
        subject: finalSubject,
        description: t.descriptionTemplate,
        ...(t.defaultPriorityId !== undefined ? { priorityId: t.defaultPriorityId } : {}),
        ...(t.defaultLabelIds !== undefined ? { labelIds: t.defaultLabelIds.filter((id) => labels.has(id)) } : {}),
        ...(t.defaultAssigneeIds !== undefined ? { assigneeIds: t.defaultAssigneeIds.filter((id) => members.has(id)) } : {}),
        ...(t.defaultCustomFields !== undefined ? { customFields: t.defaultCustomFields } : {}),
      };
    },
  };
}
