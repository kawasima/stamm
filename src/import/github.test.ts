import { describe, expect, it } from "vitest";
import { createSqlBehaviors } from "../impl/index.js";
import { createTestDb } from "../impl/test-db.js";
import { ensureBootstrapped } from "../impl/bootstrap.js";
import { importGitHub, type GitHubComment, type GitHubIssue, type ImportOptions } from "./github.js";

const REPO = "acme/app";
const url = (n: number) => `https://github.com/${REPO}/issues/${n}`;
const issue = (n: number, over: Partial<GitHubIssue> = {}): GitHubIssue => ({
  number: n, html_url: url(n), title: `Issue ${n}`, body: `Body ${n}`, state: "open", state_reason: null,
  created_at: `2026-01-0${n}T00:00:00Z`, updated_at: `2026-01-0${n}T00:00:00Z`, closed_at: null,
  user: { login: "octo" }, assignees: [], labels: [], milestone: null, ...over,
});
const comment = (n: number, id: number, at: string, over: Partial<GitHubComment> = {}): GitHubComment => ({
  html_url: `${url(n)}#issuecomment-${id}`, issue_url: `https://api.github.com/repos/${REPO}/issues/${n}`,
  body: `Comment ${id}`, created_at: at, updated_at: at, user: { login: "octo" }, ...over,
});

async function world() {
  const db = await createTestDb();
  let clock = "2026-06-01T00:00:00.000Z";
  const b = createSqlBehaviors(db, { now: () => clock, silent: true });
  const seed = (await ensureBootstrapped(b))!;
  const run = (issues: GitHubIssue[], comments: GitHubComment[] = [], opts: Partial<ImportOptions> = {}) =>
    importGitHub({ behaviors: b, setClock: (t) => { clock = t; } }, { issues, comments }, { repo: REPO, project: "app", ...opts });
  const list = async () => {
    const project = (await b.getProjectByIdentifier({ actorId: seed.adminId, identifier: "app" }))!;
    const { items } = await b.listIssues({ actorId: seed.adminId, filter: { projectId: project.id }, include: ["labels", "parent", "milestone", "assignees"], sortBy: "number", pagination: { limit: 50 } });
    return items;
  };
  const commentsOf = async (issueId: string) =>
    (await b.listComments({ actorId: seed.adminId, issueId, pagination: { limit: 50 } })).items;
  return { db, b, seed, run, list, commentsOf };
}

describe("importGitHub", () => {
  it("imports issues with GitHub's times, state, labels, milestone and parent, skipping pull requests", async () => {
    const w = await world();
    const report = await w.run([
      issue(1, {
        state: "closed", state_reason: "completed", closed_at: "2026-01-05T00:00:00Z",
        labels: [{ name: "bug", color: "d73a4a", description: "Broken" }],
        milestone: { title: "v1", description: null, due_on: "2026-02-01T08:00:00Z", state: "closed" },
      }),
      issue(2, { parent_issue_url: `https://api.github.com/repos/${REPO}/issues/1` }),
      issue(3, { state: "closed", state_reason: "not_planned", closed_at: "2026-01-06T00:00:00Z" }),
      issue(4, { pull_request: {} }),
    ], [comment(1, 11, "2026-01-02T00:00:00Z"), comment(1, 12, "2026-01-06T00:00:00Z"), comment(4, 13, "2026-01-06T00:00:00Z")]);
    expect(report).toMatchObject({ issues: 3, pullRequestsSkipped: 1, created: 3, commentsCreated: 2, parentsSet: 1 });

    const [first, second, third] = await w.list();
    expect(first!.statusId).toBe(w.seed.statusIds.done);
    expect(first!.labels!.map((l) => l.name)).toEqual(["bug"]);
    expect(first!.milestone!.name).toBe("v1");
    expect(second!.statusId).toBe(w.seed.statusIds.todo);
    expect(second!.parent!.id).toBe(first!.id);
    expect(third!.labels!.map((l) => l.name)).toEqual(["not planned"]);

    const history = await w.b.listIssueStatusHistory({ actorId: w.seed.adminId, issueId: first!.id, pagination: { limit: 10 } });
    expect(history.items.map((h) => h.occurredAt)).toEqual(["2026-01-01T00:00:00.000Z", "2026-01-05T00:00:00.000Z"]);
    expect((await w.commentsOf(first!.id)).map((c) => c.occurredAt)).toEqual(["2026-01-02T00:00:00.000Z", "2026-01-06T00:00:00.000Z"]);
    const created = await w.db.selectFrom("activity_entries").select("occurred_at").where("target_id", "=", first!.id).where("action", "=", "created").executeTakeFirst();
    expect(created!.occurred_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("names an unmapped author in the text and writes a mapped one as their stamm user", async () => {
    const w = await world();
    const report = await w.run(
      [issue(1, { assignees: [{ login: "Me" }, { login: "octo" }] }), issue(2, { user: { login: "Me" } })],
      [comment(1, 11, "2026-01-02T00:00:00Z", { user: { login: "Me" } }), comment(1, 12, "2026-01-03T00:00:00Z", { user: null })],
      { userMap: { me: "member" } },
    );
    const [first, second] = await w.list();
    expect(first!.description).toBe(`> [acme/app#1](${url(1)}) by octo\n\nBody 1`);
    expect(first!.assignees!.map((u) => u.id)).toEqual([w.seed.memberId]);
    expect(second!.authorId).toBe(w.seed.memberId);
    expect(second!.description).toBe("Body 2");
    const [byMe, byGhost] = await w.commentsOf(first!.id);
    expect(byMe!.authorId).toBe(w.seed.memberId);
    expect(byGhost!.body).toContain("by ghost");
    expect(report.unmappedAuthors).toEqual({ octo: 1, ghost: 1 });
    expect(report.unmappedAssignees).toEqual({ octo: 1 });
  });

  it("does not treat a GitHub login as the stamm user of the same name", async () => {
    const w = await world();
    await w.run([issue(1, { user: { login: "member" } })]);
    expect((await w.list())[0]!.authorId).not.toBe(w.seed.memberId);
  });

  it("changes nothing on a second run and picks up what changed on GitHub", async () => {
    const w = await world();
    const c = comment(1, 11, "2026-01-02T00:00:00Z");
    await w.run([issue(1), issue(2)], [c]);
    expect(await w.run([issue(1), issue(2)], [c])).toMatchObject({ existing: 2, created: 0, updated: 0, unchanged: 2, commentsCreated: 0, commentsUpdated: 0 });

    const local = (await w.list())[0]!;
    await w.b.createComment({ actorId: w.seed.adminId, issueId: local.id, body: "written in stamm" });
    const report = await w.run(
      [issue(1, { title: "Renamed", state: "closed", closed_at: "2026-01-09T00:00:00Z", labels: [{ name: "bug", color: "d73a4a", description: null }] }), issue(2), issue(3)],
      [{ ...c, body: "Edited" }, comment(1, 12, "2026-01-08T00:00:00Z")],
    );
    expect(report).toMatchObject({ created: 1, updated: 1, unchanged: 1, commentsCreated: 1, commentsUpdated: 1 });
    const [first] = await w.list();
    expect(first!.subject).toBe("Renamed");
    expect(first!.statusId).toBe(w.seed.statusIds.done);
    expect(first!.labels!.map((l) => l.name)).toEqual(["bug"]);
    const bodies = (await w.commentsOf(first!.id)).map((x) => x.body);
    expect(bodies).toHaveLength(3);
    expect(bodies).toContain("written in stamm");
    expect(bodies.some((x) => x.endsWith("Edited"))).toBe(true);

    await w.run([issue(1, { title: "Renamed" })], []);
    expect((await w.list())[0]!.statusId).toBe(w.seed.statusIds.todo);
  });

  it("sends no notifications, even when a text mentions a member", async () => {
    const w = await world();
    await w.run([issue(1)], [comment(1, 11, "2026-01-02T00:00:00Z", { body: "ping @member" })], { userMap: { someone: "member" } });
    expect((await w.b.listNotifications({ actorId: w.seed.memberId, pagination: { limit: 10 } })).items).toEqual([]);
  });

  it("writes nothing on a dry run", async () => {
    const w = await world();
    const report = await w.run([issue(1)], [comment(1, 11, "2026-01-02T00:00:00Z")], { dryRun: true });
    expect(report).toMatchObject({ created: 1, commentsCreated: 1 });
    expect(await w.b.getProjectByIdentifier({ actorId: w.seed.adminId, identifier: "app" })).toBeNull();
  });

  it("refuses a project it did not create, and a mapping to an unknown user", async () => {
    const w = await world();
    await expect(w.run([issue(1)], [], { project: "default" })).rejects.toThrow(/not created by this import/);
    await expect(w.run([issue(1)], [], { userMap: { octo: "nobody" } })).rejects.toThrow(/No stamm user/);
  });
});
