#!/usr/bin/env node
import { execFile } from "node:child_process";
import { parseArgs, promisify } from "node:util";
import { createSqlBehaviors, makeSqlite, migrateToLatest } from "../impl/index.js";
import { importGitHub, type GitHubComment, type GitHubIssue } from "../import/github.js";

/**
 * One-way import of GitHub issues (not pull requests) and their comments.
 *
 *   STAMM_DB=stamm.db stamm-import-github --repo owner/name --project <identifier>
 *     [--map <githubLogin>=<stammLogin>]...  write that person's texts as a stamm user
 *     [--role <name>]                        role for the import user (default: Member)
 *     [--dry-run]                            report what would be created, write nothing
 *
 * GitHub is read through the `gh` CLI, which must be logged in.
 */
async function ghList<T>(path: string): Promise<T[]> {
  const { stdout } = await promisify(execFile)("gh", ["api", "--paginate", path, "--jq", ".[]"], { maxBuffer: 1024 * 1024 * 1024 });
  return stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      project: { type: "string" },
      map: { type: "string", multiple: true, default: [] },
      role: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (!values.repo || !/^[\w.-]+\/[\w.-]+$/.test(values.repo)) throw new Error("--repo owner/name is required");
  if (!values.project) throw new Error("--project <identifier> is required");
  const userMap: Record<string, string> = {};
  for (const m of values.map) {
    const [gh, login, ...rest] = m.split("=");
    if (!gh || !login || rest.length > 0) throw new Error(`--map expects githubLogin=stammLogin, got "${m}"`);
    userMap[gh] = login;
  }

  const [issues, comments] = await Promise.all([
    ghList<GitHubIssue>(`repos/${values.repo}/issues?state=all&per_page=100&direction=asc`),
    ghList<GitHubComment>(`repos/${values.repo}/issues/comments?per_page=100`),
  ]);

  let clock = new Date().toISOString();
  const db = makeSqlite(process.env.STAMM_DB ?? "stamm.db");
  try {
    await migrateToLatest(db);
    const behaviors = createSqlBehaviors(db, { now: () => clock, silent: true });
    const report = await importGitHub(
      { behaviors, setClock: (t) => { clock = t; } },
      { issues, comments },
      { repo: values.repo, project: values.project, userMap, dryRun: values["dry-run"], ...(values.role ? { roleName: values.role } : {}) },
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error("[stamm-import-github]", err instanceof Error ? err.message : err);
  process.exit(1);
});
