# Metrics cookbook

stamm does not compute software-development metrics. Per
[ADR-0001](adr/0001-metrics-are-a-consumer-concern.md), it exposes **primary
observations** and leaves derived metrics to consumers. This page shows how to
compute common metrics from the read tools.

The reason for the split: a derived metric only means something as *observation +
operating rules* — the percentile, the time window, what counts as
"started"/"done", how scope change is handled. Those rules are your choices, made
in your context; stamm only owns the observation. Each recipe below names the
rules you have to pick.

A runnable version of the first three recipes is [`sim/metrics.mjs`](../sim/metrics.mjs):
after `npm run build`, run `node sim/metrics.mjs`.

## Coverage

What you can compute today from the exposed tools, and the two things that still
need an observation increment.

| Metric | Observation tool(s) | Computable now |
| --- | --- | --- |
| Cycle time / lead time | `issue_history` + `admin_list`(status) + `activity_list` | yes |
| Throughput | `issue_history` / `activity_list` | yes |
| WIP / work-item age / aging | `issue_search` + `issue_history` | yes |
| Due-date slippage | `issue_schedule_history` | yes |
| Estimate accuracy / churn | `issue_estimation_history` + `time_list` / `time_summary` | yes |
| Status / type / priority / assignee mix (snapshot) | `issue_search` (filter + `include`) | yes (count client-side) |
| Overdue | `issue_search` (`isOverdue` / `dueDateFrom` / `dueDateTo`) | yes |
| Per-assignee flow | assignment history | no — see roadmap |
| Burndown with scope change | milestone / iteration membership history | no — see roadmap |

Status categories (`todo` / `in_progress` / `done`) come from `admin_list`
with `{ params: { resource: "status", ... } }`; they ground the "started" and
"done" definitions without you inventing them.

## Recipes

### Cycle time

- Observations: `issue_history` (status transitions, chronological), the status
  category map from `admin_list`(status).
- Rules you pick: what counts as *started* (here: first entry into an
  `in_progress`-category status) and *completed* (first entry into a
  `done`-category status); which percentile/aggregate you report (median, p85).
- Steps: for each issue, pull `issue_history`; `started` = first transition whose
  `toStatusId` maps to `in_progress`; `completed` = first whose `toStatusId` maps
  to `done`; `cycle = completed.occurredAt − started.occurredAt`. Aggregate across
  issues with your chosen statistic.

### Throughput

- Observations: `issue_history` (or `activity_list` filtered to
  `action = "status_changed"`).
- Rules you pick: the window (weekly / monthly) and what "delivered" means (here:
  entered a `done`-category status).
- Steps: count issues (or transitions) that entered a `done`-category status
  within each window bucket.

### Due-date slippage

- Observations: `issue_schedule_history` (typed `from→to` history of start/due).
- Rules you pick: which due date is the "commitment" baseline (here: the first
  recorded `toDueDate`) and how to summarize (per-issue days, or a distribution).
- Steps: per issue, `slip = last toDueDate − first toDueDate`. The example yields
  19 days for an item moved from `2026-07-01` to `2026-07-20`.

### Estimate accuracy / churn

- Observations: `issue_estimation_history` (estimate `from→to` over time),
  `time_summary` / `time_list` (logged hours).
- Rules you pick: accuracy definition (logged ÷ final estimate), and whether you
  track churn (count/magnitude of estimate changes).
- Steps: final estimate = last `toHours` from the history; accuracy =
  `totalSpentHours ÷ finalEstimate`; churn = number of history entries.

### WIP and work-item age

- Observations: `issue_search` (current status via `statusCategories` filter),
  `issue_history` (when each in-flight item started).
- Rules you pick: what "in progress" means (the `in_progress` category), the age
  threshold you escalate on.
- Steps: WIP = count of `issue_search` results with `statusCategories:
  ["in_progress"]`; age = `now − started.occurredAt` per in-flight item.

### Status / type / priority / assignee mix

- Observations: `issue_search` with `filter` and `include`.
- Rules you pick: the slices, and the as-of moment (current state).
- Steps: page through `issue_search` and bucket by the field. (If a project grows
  large enough that paging to count is impractical, that is the scale signal
  ADR-0001 names for adding a metric-agnostic server-side count primitive.)

## Material roadmap (not built yet)

Two observations are deliberately not recorded yet. They are added only when a
consumer needs them, under the same rule used elsewhere: persist a change as an
event only when a metric/integrity consumer needs its time-series **and** it
cannot be reconstructed from current state plus the status timeline.

- **Per-assignee flow** — needs assignment history. `Assignment` / `Unassignment`
  exist in the schema (`src/schema/intersection.ts`) but are not persisted;
  today only the current assignee set is stored. Unlocks per-assignee WIP and
  throughput.
- **Burndown with scope change** — needs milestone / iteration membership
  history. `MilestoneSetting` and the iteration setter likewise exist in the
  schema but only the current membership is stored, so "the total moved" (the
  burndown denominator, the article's *moving denominator*) cannot be
  reconstructed. Unlocks burndown scope-change detection and scope churn.

This is why `GetBurndownData` was removed from `src/behavior/statistics.ts`: it
needs membership history that is not recorded, and it encodes a scope-change
policy that is a consumer choice. `GetOverdueIssuesSummary` was removed because
`issue_search` already answers it via `isOverdue` / `dueDate*` filters.
