import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DateString, Hours, Id, Percentage } from "../schema/common.js";
import * as B from "../behavior/index.js";
import type { Behaviors } from "./behaviors.js";
import { contractArgs, declaredResult } from "./contract.js";
import { injectActor, stripActor } from "./identity.js";

/**
 * Compound issue update: the behavior layer models each satellite (assignees,
 * labels, milestone, ...) as its own Set* operation, but agents want to change
 * several at once. This tool accepts UpdateIssue's core fields plus the
 * satellites, fans out to the relevant behaviors for whichever fields were
 * supplied (set semantics; omit a field to leave it untouched), and returns the
 * re-hydrated issue. The sub-steps run in one transaction when the backend
 * offers {@link Behaviors.atomically}: if any of them fails, none of the changes
 * are kept.
 */
const inputShape = {
  ...contractArgs(B.UpdateIssue),
  assigneeIds: z.array(Id).optional(),
  labelIds: z.array(Id).optional(),
  categoryId: Id.optional(),
  milestoneId: Id.optional(),
  parentIssueId: Id.optional(),
  iterationId: Id.optional(),
  startDate: DateString.optional(),
  dueDate: DateString.optional(),
  estimatedHours: Hours.optional(),
  doneRatio: Percentage.optional(),
} satisfies z.ZodRawShape;

type Args = {
  actorId: string;
  issueId: string;
  issueTypeId?: string;
  priorityId?: string;
  subject?: string;
  description?: string;
  visibility?: unknown;
  customFields?: unknown;
  assigneeIds?: string[];
  labelIds?: string[];
  categoryId?: string;
  milestoneId?: string;
  parentIssueId?: string;
  iterationId?: string;
  startDate?: string;
  dueDate?: string;
  estimatedHours?: number;
  doneRatio?: number;
};

const CORE_FIELDS = ["issueTypeId", "priorityId", "subject", "description", "visibility", "customFields"] as const;

export function registerIssueUpdateTool(server: McpServer, behaviors: Behaviors, pinnedActorId?: string): void {
  server.registerTool(
    "issue_update",
    {
      description:
        "Update an issue: core fields (subject, description, type, priority, visibility) " +
        "and satellites (assignees, labels, category, milestone, parent, iteration, " +
        "schedule, estimation, progress) in one call. Only supplied fields change.",
      inputSchema: stripActor(inputShape, pinnedActorId),
      annotations: { idempotentHint: true },
    },
    async (raw) => {
      const a = injectActor(raw as Record<string, unknown>, pinnedActorId) as Args;
      const { actorId, issueId } = a;

      const apply = async (b: Behaviors) => {
        if (CORE_FIELDS.some((f) => a[f] !== undefined)) {
          await b.updateIssue({
            actorId,
            issueId,
            issueTypeId: a.issueTypeId,
            priorityId: a.priorityId,
            subject: a.subject,
            description: a.description,
            visibility: a.visibility as never,
            customFields: a.customFields as never,
          });
        }
        if (a.assigneeIds !== undefined) await b.setIssueAssignees({ actorId, issueId, assigneeIds: a.assigneeIds });
        if (a.labelIds !== undefined) await b.setIssueLabels({ actorId, issueId, labelIds: a.labelIds });
        if (a.categoryId !== undefined) await b.setIssueCategory({ actorId, issueId, categoryId: a.categoryId });
        if (a.milestoneId !== undefined) await b.setIssueMilestone({ actorId, issueId, milestoneId: a.milestoneId });
        if (a.parentIssueId !== undefined) await b.setIssueParent({ actorId, childIssueId: issueId, parentIssueId: a.parentIssueId });
        if (a.iterationId !== undefined) await b.setIssueIteration({ actorId, issueId, iterationId: a.iterationId });
        if (a.startDate !== undefined || a.dueDate !== undefined) {
          await b.setIssueSchedule({ actorId, issueId, startDate: a.startDate, dueDate: a.dueDate });
        }
        if (a.estimatedHours !== undefined) await b.setIssueEstimation({ actorId, issueId, estimatedHours: a.estimatedHours });
        if (a.doneRatio !== undefined) await b.setIssueProgress({ actorId, issueId, doneRatio: a.doneRatio });
      };
      await (behaviors.atomically ? behaviors.atomically(apply) : apply(behaviors));

      const issue = declaredResult(B.GetIssueDetail, await behaviors.getIssueDetail({ actorId, issueId })) as Record<string, unknown>;
      return {
        content: [{ type: "text", text: JSON.stringify(issue) }],
        structuredContent: issue,
      };
    },
  );
}
