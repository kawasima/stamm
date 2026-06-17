// Metrics cookbook example: derive metrics from stamm's primary observations.
// stamm models no metrics (see docs/adr/0001-metrics-are-a-consumer-concern.md);
// a consumer computes them client-side from the read tools. The operating-rule
// choices (what counts as "started"/"done", the window) live here, not in stamm.
// Run after `npm run build`:  node sim/metrics.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/bin/stamm-mcp.js"],
  env: { ...process.env, STAMM_DB: "metrics.db" },
});
const client = new Client({ name: "metrics", version: "0" });
await client.connect(transport);

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${JSON.stringify(res.content)}`);
  return res.structuredContent;
};
const page = { pagination: { limit: 100 } };

// --- resolve the seeded world (reads are open to the pinned member) ---
const project = await call("project_get_by_identifier", { identifier: "default" });
const statuses = (await call("admin_list", { params: { resource: "status", ...page } })).items;
const types = (await call("admin_list", { params: { resource: "issue_type", ...page } })).items;
const priorities = (await call("admin_list", { params: { resource: "priority", ...page } })).items;
const categoryOf = Object.fromEntries(statuses.map((s) => [s.id, s.category]));
const statusOfCategory = (cat) => statuses.find((s) => s.category === cat);
const base = { projectId: project.id, issueTypeId: types[0].id, priorityId: priorities[0].id };
const inProgress = statusOfCategory("in_progress");
const done = statusOfCategory("done");

// --- produce observable history: create, schedule, move through the workflow ---
const made = [];
for (let i = 0; i < 3; i++) {
  const issue = await call("issue_create", { ...base, subject: `Item ${i + 1}`, dueDate: "2026-07-01" });
  if (i === 0) await call("issue_update", { issueId: issue.id, dueDate: "2026-07-20" }); // a slip on item 1
  await call("issue_transition", { issueId: issue.id, toStatusId: inProgress.id });
  await call("issue_transition", { issueId: issue.id, toStatusId: done.id });
  made.push(issue);
}

// === derive metrics — every definition below is the consumer's choice ===

// Cycle time: "started" = first entry into an in_progress-category status,
// "completed" = first entry into a done-category status.
const cycleMs = [];
for (const issue of made) {
  const hist = (await call("issue_history", { issueId: issue.id, ...page })).items; // chronological asc
  const started = hist.find((h) => categoryOf[h.toStatusId] === "in_progress");
  const completed = hist.find((h) => categoryOf[h.toStatusId] === "done");
  if (started && completed) cycleMs.push(Date.parse(completed.occurredAt) - Date.parse(started.occurredAt));
}
const avgCycleMs = cycleMs.reduce((a, b) => a + b, 0) / (cycleMs.length || 1);

// Throughput: items that entered a done-category status (window = all, here).
let throughput = 0;
for (const issue of made) {
  const hist = (await call("issue_history", { issueId: issue.id, ...page })).items;
  if (hist.some((h) => categoryOf[h.toStatusId] === "done")) throughput++;
}

// Due-date slippage: final committed due date minus the first, in days.
const sched = (await call("issue_schedule_history", { issueId: made[0].id, ...page })).items;
const dues = sched.map((s) => s.toDueDate).filter(Boolean);
const slipDays = (Date.parse(dues[dues.length - 1]) - Date.parse(dues[0])) / 86_400_000;

console.log(`cycle time (avg):  ${(avgCycleMs / 1000).toFixed(3)} s  (n=${cycleMs.length}; demo timestamps are wall-clock, so sub-second)`);
console.log(`throughput:        ${throughput} items reached done`);
console.log(`due-date slippage: ${slipDays} days (item 1: first → last committed due)`);

await client.close();
