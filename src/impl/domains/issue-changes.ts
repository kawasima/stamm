import { sql, type RawBuilder } from "kysely";
import { IssueChangeKind, IssueEstimationChange, IssueScheduleChange, IssueStatusChange, type IssueChange } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { makeCodec, type RowCodec } from "../db/codec.js";
import { listPage, type Page } from "../listing.js";
import { assertCanReadProject } from "../permissions.js";
import { assertCanReadIssueEvents, issueEventsVisible, issueInProject } from "../issue-visibility.js";

type Methods = "listIssueChanges" | "listIssueStatusHistory" | "listIssueScheduleHistory" | "listIssueEstimationHistory";
type Paging = { limit?: number | undefined; cursor?: string | undefined } | undefined;
interface Key { id: string; kind: IssueChangeKind; occurred_at: string; seq: number }

const TABLE = {
  status: "issue_status_changes",
  schedule: "issue_schedule_changes",
  estimation: "issue_estimation_changes",
} as const satisfies Record<IssueChangeKind, string>;

/**
 * Read access to the typed change Events of issues, per issue and per project.
 *
 * Events are ordered by (occurredAt, seq, id): `seq` is the Event's position in its
 * own issue's history, so changes of one issue that share an instant keep the order
 * they were made in. Both listings page with that key. The cursor is opaque, and
 * following it is not a way to wait for new Events: one can be recorded later with
 * an earlier occurredAt (an import does that).
 */
export function issueChangeBehaviors(ctx: Ctx): Pick<Behaviors, Methods> {
  const db = ctx.db;
  // One per kind: the codec re-establishes the typing the generic query loses.
  const codecs: Record<IssueChangeKind, RowCodec<unknown>> = {
    status: makeCodec(IssueStatusChange),
    schedule: makeCodec(IssueScheduleChange),
    estimation: makeCodec(IssueEstimationChange),
  };

  /** A page of the Events matching `where`, as keys in order, then filled in by kind. */
  const list = async (kinds: IssueChangeKind[], where: RawBuilder<boolean>, pagination: Paging): Promise<Page<{ kind: IssueChangeKind; event: unknown }>> => {
    const each = kinds.map((k) => sql`select id, issue_id, occurred_at, seq, ${sql.lit(k)} as kind from ${sql.table(TABLE[k])}`);
    const all = sql<Key>`(${sql.join(each, sql` union all `)})`.as("e");
    const page = await listPage(
      db.selectFrom(all).select(["e.id", "e.kind"]).where(where),
      { name: "changes", keys: [{ by: sql.ref("e.occurred_at"), dir: "asc" }, { by: sql.ref("e.seq"), dir: "asc" }] },
      "e.id", pagination,
    ) as Page<Pick<Key, "id" | "kind">>;

    const events = new Map<string, unknown>();
    for (const kind of kinds) {
      const ids = page.items.filter((k) => k.kind === kind).map((k) => k.id);
      if (ids.length === 0) continue;
      for (const r of await db.selectFrom(TABLE[kind] as "issue_status_changes").selectAll().where("id", "in", ids).execute()) {
        events.set(r.id, codecs[kind].decode(r as never));
      }
    }
    return {
      items: page.items.map((k) => ({ kind: k.kind, event: events.get(k.id) })),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  };

  const ofIssue = async (kind: IssueChangeKind, args: { actorId: string; issueId: string; pagination?: Paging }) => {
    await assertCanReadIssueEvents(ctx, args.issueId, args.actorId);
    const page = await list([kind], sql<boolean>`e.issue_id = ${args.issueId}`, args.pagination);
    return { items: page.items.map((i) => i.event) as never, nextCursor: page.nextCursor };
  };

  // Stored instants are ISO with milliseconds and compared as text.
  const instant = (t: string): string => new Date(t).toISOString();

  return {
    listIssueChanges: async ({ actorId, projectId, kinds, occurredFrom, occurredUntil, pagination }) => {
      await assertCanReadProject(ctx, projectId, actorId);
      const issueId = sql.ref("e.issue_id");
      let where = sql<boolean>`${issueInProject(issueId, projectId)} and ${await issueEventsVisible(ctx, actorId, issueId)}`;
      if (occurredFrom) where = sql<boolean>`${where} and e.occurred_at >= ${instant(occurredFrom)}`;
      if (occurredUntil) where = sql<boolean>`${where} and e.occurred_at < ${instant(occurredUntil)}`;
      const page = await list([...new Set(kinds ?? IssueChangeKind.options)], where, pagination);
      return { items: page.items.map((i) => ({ kind: i.kind, ...(i.event as object) }) as IssueChange), nextCursor: page.nextCursor };
    },
    listIssueStatusHistory: (args) => ofIssue("status", args),
    listIssueScheduleHistory: (args) => ofIssue("schedule", args),
    listIssueEstimationHistory: (args) => ofIssue("estimation", args),
  };
}
