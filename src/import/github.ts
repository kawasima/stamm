import type { Behaviors } from "../mcp/behaviors.js";

/** The parts of a GitHub REST issue the import reads. */
export interface GitHubIssue {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  state_reason: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  user: { login: string } | null;
  assignees: { login: string }[];
  labels: { name: string; color: string; description: string | null }[];
  milestone: { title: string; description: string | null; due_on: string | null; state: "open" | "closed" } | null;
  parent_issue_url?: string | null;
  /** Present only when the "issue" is really a pull request. */
  pull_request?: unknown;
}

export interface GitHubComment {
  html_url: string;
  issue_url: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
}

export interface ImportOptions {
  /** "owner/repo", used for display. */
  repo: string;
  /** Identifier of the stamm project to import into; created when absent. */
  project: string;
  /** GitHub login -> stamm login. Anyone not listed is written by the import user. */
  userMap?: Record<string, string>;
  /** Role given to the import user and to mapped users. */
  roleName?: string;
  dryRun?: boolean;
}

export interface ImportDeps {
  behaviors: Behaviors;
  /** Sets the time the behaviors stamp on what they write. */
  setClock: (iso: string) => void;
}

export interface ImportReport {
  issues: number;
  pullRequestsSkipped: number;
  /** Already imported by an earlier run. A dry run does not compare them further. */
  existing: number;
  created: number;
  updated: number;
  unchanged: number;
  commentsCreated: number;
  commentsUpdated: number;
  labelsCreated: number;
  milestonesCreated: number;
  parentsSet: number;
  /** GitHub logins written under the import user, with how many texts each has. */
  unmappedAuthors: Record<string, number>;
  /** Assignments dropped because the assignee has no stamm user. */
  unmappedAssignees: Record<string, number>;
}

const FIELD_NAME = "GitHub URL";
const IMPORT_LOGIN = "github-import";
const NOT_PLANNED = { name: "not planned", color: "ededed", description: "Closed on GitHub as not planned" };
const COMMENT_MARKER = /^> \[GitHub comment\]\((\S+?)\)/;

type Listing<T> = { items: T[]; nextCursor?: string | undefined };
async function all<T>(fetchPage: (pagination: { limit: number; cursor?: string }) => Promise<Listing<T>>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage({ limit: 100, ...(cursor ? { cursor } : {}) });
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

const numberOf = (url: string): number => Number(url.slice(url.lastIndexOf("/") + 1));
const bump = (rec: Record<string, number>, key: string): void => { rec[key] = (rec[key] ?? 0) + 1; };
const iso = (t: string): string => new Date(t).toISOString();
const labelColor = (c: string): string => (/^[0-9a-fA-F]{6}$/.test(c) ? `#${c}` : "#ededed");
const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Import GitHub issues and their comments, one way. Safe to repeat: each issue
 * carries its GitHub URL in a custom field and each comment in its first line,
 * so a second run creates only what is new and updates what changed on GitHub.
 * GitHub wins over local edits to imported text, labels and open/closed state;
 * comments added in stamm are left alone, and nothing is ever deleted.
 */
export async function importGitHub(
  deps: ImportDeps,
  source: { issues: GitHubIssue[]; comments: GitHubComment[] },
  opts: ImportOptions,
): Promise<ImportReport> {
  const { behaviors: b, setClock } = deps;
  const atomically: NonNullable<Behaviors["atomically"]> = b.atomically ?? ((fn) => fn(b));
  const userMap = new Map(Object.entries(opts.userMap ?? {}).map(([gh, st]) => [gh.toLowerCase(), st.toLowerCase()]));

  const issues = source.issues
    .filter((i) => !i.pull_request)
    .sort((x, y) => x.created_at.localeCompare(y.created_at) || x.number - y.number);
  const report: ImportReport = {
    issues: issues.length, pullRequestsSkipped: source.issues.length - issues.length,
    existing: 0, created: 0, updated: 0, unchanged: 0, commentsCreated: 0, commentsUpdated: 0,
    labelsCreated: 0, milestonesCreated: 0, parentsSet: 0, unmappedAuthors: {}, unmappedAssignees: {},
  };
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const commentsOf = new Map<number, GitHubComment[]>();
  for (const c of [...source.comments].sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    const n = numberOf(c.issue_url);
    if (byNumber.has(n)) commentsOf.set(n, [...(commentsOf.get(n) ?? []), c]);
  }

  // --- Who and what we write with ---
  const users = await all((pagination) => b.listUsers({ pagination }));
  const userByLogin = new Map(users.map((u) => [u.login.toLowerCase(), u]));
  const admin = users.find((u) => u.kind === "admin");
  if (!admin) throw new Error("No admin user: the import needs one to set the project up");
  const mapped = new Map<string, string>();
  for (const [gh, login] of userMap) {
    const user = userByLogin.get(login);
    if (!user) throw new Error(`No stamm user with login "${login}" (mapped from GitHub user "${gh}")`);
    mapped.set(gh, user.id);
  }
  const roleName = opts.roleName ?? "Member";
  const role = (await all((pagination) => b.listRoles({ pagination }))).find((r) => r.name === roleName);
  if (!role) throw new Error(`No role named "${roleName}"`);
  const statuses = (await all((pagination) => b.listStatuses({ pagination }))).sort((x, y) => x.sortOrder - y.sortOrder);
  const todo = statuses.find((s) => s.category === "todo");
  const done = statuses.find((s) => s.category === "done");
  const issueType = (await all((pagination) => b.listIssueTypes({ pagination })))[0];
  const priority = (await all((pagination) => b.listPriorities({ pagination })))[0];
  if (!todo || !done || !issueType || !priority) throw new Error("Need a todo status, a done status, an issue type and a priority");
  const isDone = new Set(statuses.filter((s) => s.category === "done").map((s) => s.id));

  let project = await b.getProjectByIdentifier({ actorId: admin.id, identifier: opts.project });
  const fields = project
    ? await all((pagination) => b.listCustomFieldDefinitions({ projectId: project!.id, pagination }))
    : [];
  let field = fields.find((f) => f.name === FIELD_NAME && f.scope.projectIds?.includes(project!.id));
  if (project && !field) {
    throw new Error(`Project "${opts.project}" exists and was not created by this import; choose another identifier`);
  }

  // --- What is already there ---
  type Existing = { id: string; subject: string; description?: string | undefined; statusId: string; labelIds: string[]; parentId?: string | undefined; milestoneId?: string | undefined; authorId: string };
  const existing = new Map<string, Existing>();
  if (project && field) {
    const rows = await all((pagination) =>
      b.listIssues({ actorId: admin.id, filter: { projectId: project!.id }, include: ["labels", "parent", "milestone"], pagination }));
    for (const r of rows) {
      const url = r.customFields.find((v) => v.fieldId === field!.id)?.value;
      if (typeof url !== "string") continue;
      existing.set(url, {
        id: r.id, subject: r.subject, description: r.description, statusId: r.statusId,
        labelIds: (r.labels ?? []).map((l) => l.id), parentId: r.parent?.id, milestoneId: r.milestone?.id, authorId: r.authorId,
      });
    }
  }

  const ghLogin = (u: { login: string } | null): string => u?.login ?? "ghost";
  for (const i of issues) {
    if (!mapped.has(ghLogin(i.user).toLowerCase())) bump(report.unmappedAuthors, ghLogin(i.user));
    for (const a of i.assignees) if (!mapped.has(a.login.toLowerCase())) bump(report.unmappedAssignees, a.login);
    for (const c of commentsOf.get(i.number) ?? []) {
      if (!mapped.has(ghLogin(c.user).toLowerCase())) bump(report.unmappedAuthors, ghLogin(c.user));
    }
  }

  report.existing = issues.filter((i) => existing.has(i.html_url)).length;

  const wantedLabels = new Map<string, { name: string; color: string; description: string | null }>();
  const labelsFor = (i: GitHubIssue) => (i.state_reason === "not_planned" ? [...i.labels, NOT_PLANNED] : i.labels);
  for (const i of issues) for (const l of labelsFor(i)) wantedLabels.set(l.name, l);
  const wantedMilestones = new Map(issues.flatMap((i) => (i.milestone ? [[i.milestone.title, i.milestone] as const] : [])));

  if (opts.dryRun) {
    report.created = issues.length - report.existing;
    const haveLabels = project ? await all((pagination) => b.listLabels({ projectId: project!.id, pagination })) : [];
    report.labelsCreated = [...wantedLabels.keys()].filter((n) => !haveLabels.some((l) => l.name === n)).length;
    for (const i of issues) if (!existing.has(i.html_url)) report.commentsCreated += (commentsOf.get(i.number) ?? []).length;
    report.milestonesCreated = project ? 0 : wantedMilestones.size;
    report.parentsSet = issues.filter((i) => i.parent_issue_url && byNumber.has(numberOf(i.parent_issue_url)) && !existing.has(i.html_url)).length;
    return report;
  }

  // --- Project setup ---
  if (!project) {
    await atomically(async (t) => {
      project = await t.createProject({ actorId: admin.id, identifier: opts.project, name: opts.repo, description: `Imported from https://github.com/${opts.repo}` });
      field = await t.createCustomFieldDefinition({ actorId: admin.id, name: FIELD_NAME, fieldType: "url", constraints: {}, scope: { projectIds: [project.id] } });
      await t.setDefaultStatus({ actorId: admin.id, projectId: project.id, issueTypeId: issueType.id, statusId: todo.id });
      await t.setWorkflowTransitions({
        actorId: admin.id, projectId: project.id, issueTypeId: issueType.id,
        transitions: statuses.flatMap((f) => statuses.filter((s) => s.id !== f.id).map((s) => ({ fromStatusId: f.id, toStatusId: s.id, roleIds: [] }))),
      });
    });
  }
  const projectId = project!.id;
  const fieldId = field!.id;
  const importUser = userByLogin.get(IMPORT_LOGIN)
    ?? (await b.createUser({ actorId: admin.id, login: IMPORT_LOGIN, email: `${IMPORT_LOGIN}@stamm.local`, displayName: "GitHub import" }));
  const members = new Set((await all((pagination) => b.listProjectMembers({ actorId: admin.id, projectId, pagination }))).map((m) => m.userId));
  for (const userId of new Set([importUser.id, ...mapped.values()])) {
    if (!members.has(userId)) await b.addProjectMember({ actorId: admin.id, projectId, userId, roleIds: [role.id] });
  }

  const labelId = new Map((await all((pagination) => b.listLabels({ projectId, pagination }))).map((l) => [l.name, l.id]));
  for (const l of wantedLabels.values()) {
    if (labelId.has(l.name)) continue;
    const made = await b.createLabel({ actorId: admin.id, projectId, name: l.name, color: labelColor(l.color), ...(l.description ? { description: l.description } : {}) });
    labelId.set(l.name, made.id);
    report.labelsCreated++;
  }
  const milestoneId = new Map((await all((pagination) => b.listMilestones({ actorId: admin.id, projectId, pagination }))).map((m) => [m.name, m.id]));
  for (const m of wantedMilestones.values()) {
    if (milestoneId.has(m.title)) continue;
    const made = await b.createMilestone({
      actorId: admin.id, projectId, name: m.title,
      ...(m.description ? { description: m.description } : {}), ...(m.due_on ? { dueDate: m.due_on.slice(0, 10) } : {}),
    });
    if (m.state === "closed") await b.closeMilestone({ actorId: admin.id, milestoneId: made.id });
    milestoneId.set(m.title, made.id);
    report.milestonesCreated++;
  }

  // --- Texts. An unmapped author is named in the text, without "@", so it is not a mention. ---
  const userFor = (u: { login: string } | null): string => mapped.get(ghLogin(u).toLowerCase()) ?? importUser.id;
  const descriptionOf = (i: GitHubIssue): string | undefined => {
    const body = i.body ?? "";
    if (mapped.has(ghLogin(i.user).toLowerCase())) return body || undefined;
    return `> [${opts.repo}#${i.number}](${i.html_url}) by ${ghLogin(i.user)}\n\n${body}`.trimEnd();
  };
  const commentBodyOf = (c: GitHubComment): string => {
    const by = mapped.has(ghLogin(c.user).toLowerCase()) ? "" : ` by ${ghLogin(c.user)}`;
    return `> [GitHub comment](${c.html_url})${by}\n\n${c.body ?? ""}`.trimEnd();
  };

  // --- Issues, oldest first, one transaction each ---
  const idByNumber = new Map<number, string>();
  for (const i of issues) {
    const was = existing.get(i.html_url);
    const labelIds = [...new Set(labelsFor(i).map((l) => labelId.get(l.name)!))];
    const milestone = i.milestone ? milestoneId.get(i.milestone.title) : undefined;
    const description = descriptionOf(i);
    const actorId = userFor(i.user);
    const comments = commentsOf.get(i.number) ?? [];

    await atomically(async (t) => {
      let issueId: string;
      if (!was) {
        setClock(iso(i.created_at));
        const made = await t.createIssue({
          actorId, projectId, issueTypeId: issueType.id, priorityId: priority.id, statusId: todo.id,
          subject: i.title, ...(description ? { description } : {}),
          customFields: [{ fieldId, value: i.html_url }], labelIds,
          assigneeIds: i.assignees.flatMap((a) => mapped.get(a.login.toLowerCase()) ?? []),
          ...(milestone ? { milestoneId: milestone } : {}),
        });
        issueId = made.id;
        report.created++;
      } else {
        issueId = was.id;
        let changed = false;
        setClock(iso(i.updated_at));
        if (was.subject !== i.title || (was.description ?? "") !== (description ?? "")) {
          await t.updateIssue({ actorId: importUser.id, issueId, subject: i.title, description: description ?? "" });
          changed = true;
        }
        if (!sameSet(was.labelIds, labelIds)) {
          await t.setIssueLabels({ actorId: importUser.id, issueId, labelIds });
          changed = true;
        }
        if (milestone && milestone !== was.milestoneId) {
          await t.setIssueMilestone({ actorId: importUser.id, issueId, milestoneId: milestone });
          changed = true;
        }
        const closed = i.state === "closed";
        if (closed !== isDone.has(was.statusId)) changed = true;
        changed ? report.updated++ : report.unchanged++;
      }
      idByNumber.set(i.number, issueId);

      // Comments and the closing are replayed in the order they happened.
      const present = new Map<string, { id: string; body: string; authorId: string }>();
      if (was && comments.length > 0) {
        for (const c of await all((pagination) => t.listComments({ actorId: importUser.id, issueId, pagination }))) {
          const url = COMMENT_MARKER.exec(c.body)?.[1];
          if (url) present.set(url, c);
        }
      }
      const statusNow = was?.statusId ?? todo.id;
      const closing = (i.state === "closed") !== isDone.has(statusNow)
        ? { at: i.state === "closed" ? (i.closed_at ?? i.updated_at) : i.updated_at, to: i.state === "closed" ? done.id : todo.id }
        : undefined;
      let pending = closing;
      const transition = async () => {
        setClock(iso(pending!.at));
        await t.transitionIssueStatus({ actorId: importUser.id, issueId, toStatusId: pending!.to });
        pending = undefined;
      };
      for (const c of comments) {
        if (pending && pending.at < c.created_at) await transition();
        const body = commentBodyOf(c);
        const have = present.get(c.html_url);
        if (!have) {
          setClock(iso(c.created_at));
          await t.createComment({ issueId, actorId: userFor(c.user), body });
          report.commentsCreated++;
        } else if (have.body !== body) {
          setClock(iso(c.updated_at));
          await t.updateComment({ actorId: have.authorId, commentId: have.id, body });
          report.commentsUpdated++;
        }
      }
      if (pending) await transition();
    });
  }

  for (const i of issues) {
    const parentId = i.parent_issue_url ? idByNumber.get(numberOf(i.parent_issue_url)) : undefined;
    if (!parentId || existing.get(i.html_url)?.parentId === parentId) continue;
    await b.setIssueParent({ actorId: importUser.id, childIssueId: idByNumber.get(i.number)!, parentIssueId: parentId });
    report.parentsSet++;
  }
  return report;
}
