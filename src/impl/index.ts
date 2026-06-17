import type { Kysely } from "kysely";
import type { Behaviors } from "../mcp/behaviors.js";
import type { Database } from "./db/schema.js";
import { makeCtx, type CtxOptions } from "./ctx.js";
import { configBehaviors } from "./domains/config.js";
import { userExtraBehaviors } from "./domains/user-extras.js";
import { credentialBehaviors } from "./domains/credentials.js";
import { projectBehaviors } from "./domains/project.js";
import { workflowConfigBehaviors } from "./domains/workflow-config.js";
import { issueBehaviors } from "./domains/issue.js";
import { issueSatelliteBehaviors } from "./domains/issue-satellites.js";
import { commentBehaviors } from "./domains/comment.js";
import { attachmentBehaviors } from "./domains/attachment.js";
import { milestoneBehaviors } from "./domains/milestone.js";
import { iterationBehaviors } from "./domains/iteration.js";
import { timeEntryBehaviors } from "./domains/time-entry.js";
import { notificationBehaviors } from "./domains/notification.js";
import { activityBehaviors } from "./domains/activity.js";
import { draftBehaviors } from "./domains/draft.js";
import { templateBehaviors } from "./domains/template.js";
import { viewBehaviors } from "./domains/view.js";

export { makeSqlite, makePostgres } from "./db/dialects.js";
export { migrateToLatest } from "./db/migrate.js";
export { makeCtx, type CtxOptions } from "./ctx.js";
export type { Database } from "./db/schema.js";

/**
 * Assemble a full SQL-backed {@link Behaviors} from a Kysely database. The spread
 * of every domain's partial must cover the whole interface — TypeScript fails
 * the return type if any method is missing, which is the completeness check.
 */
export function createSqlBehaviors(db: Kysely<Database>, opts: CtxOptions = {}): Behaviors {
  const ctx = makeCtx(db, opts);
  return {
    ...configBehaviors(ctx),
    ...userExtraBehaviors(ctx),
    ...credentialBehaviors(ctx),
    ...projectBehaviors(ctx),
    ...workflowConfigBehaviors(ctx),
    ...issueBehaviors(ctx),
    ...issueSatelliteBehaviors(ctx),
    ...commentBehaviors(ctx),
    ...attachmentBehaviors(ctx),
    ...milestoneBehaviors(ctx),
    ...iterationBehaviors(ctx),
    ...timeEntryBehaviors(ctx),
    ...notificationBehaviors(ctx),
    ...activityBehaviors(ctx),
    ...draftBehaviors(ctx),
    ...templateBehaviors(ctx),
    ...viewBehaviors(ctx),
  };
}
