# 1. Metrics are a consumer concern; stamm exposes primary observations

- Status: Accepted
- Date: 2026-06-17

## Context

stamm is a headless project management system: it ships the model and the
behavior of issue tracking and exposes them over MCP, leaving any UI — and any
analytics — to consumers, who are expected to generate their own clients (often
with an LLM).

A natural question followed from making the timeline a faithful event log: should
stamm also compute software-development metrics (cycle time, throughput,
burndown, velocity, DORA, SLE, Monte Carlo forecasts, …)? An unimplemented
`statistics.ts` set of contracts (status/burndown/overdue summaries) made this an
open invitation.

A useful split (from the software-development-metrics literature) is *primary
observation* vs *derived metric*. A derived metric only has meaning as a triple:
the primary observation **plus** operating rules — target, recompute frequency,
threshold/percentile, time window, and the definition of "started"/"done" beyond
status category, and how scope change is handled. The same observation (e.g.
cycle time) is used differently for steering vs improvement measurement, and a
metric becomes meaningless the moment its definition is fixed to one opinion and
turned into a target.

stamm can only own the first element of that triple. The operating rules are
context-dependent choices that belong to whoever is steering the work. There are
~40 named metrics in common use; modeling a subset draws an arbitrary line and
still forces a raw-access path for the rest, which makes per-metric endpoints
mostly redundant convenience. And because stamm's consumers generate their own
clients, computing metrics is the client's job — modeling them in stamm would
duplicate what the client is meant to do.

## Decision

stamm persists and exposes **metric-agnostic primary observations** and does
**not** model named or parameterized metrics.

The primary observations are the lifecycle and change events (append-only,
typed `Event` tables such as `issue_status_changes`, `issue_schedule_changes`,
`issue_estimation_changes`, plus the `activity_entries` feed) together with the
current-state `Resource` rows they project onto. Resources are deletable; Events
are append-only and survive resource deletion, so time series have no silent
holes.

A capability is admitted into stamm only if **both** hold:

1. **Metric-agnostic.** Its definition comes entirely from stamm's own model
   (entities, status `category`, configuration), with no consumer-chosen
   parameter — no percentile, window, target, threshold, scope-change policy, or
   "done" definition beyond status category.
2. **Server-side aggregation is justified by scale.** A consumer pulling the
   already-exposed observations could not compute it efficiently (round-trips or
   data volume make a server-side rollup worthwhile).

If a capability needs a consumer-chosen parameter, it is a metric and lives in
the consumer. If a consumer can compute it cheaply from exposed observations,
stamm does not grow surface area for it.

Under this rule, a thin set of metric-agnostic, category-grounded aggregation
primitives (e.g. per-status residence durations, counts of transitions into a
category per time bucket) may be added **when scale demands it** — these are
building blocks, not metrics. Named/parameterized metrics — burndown (which
encodes a scope-change policy), velocity, SLE, Monte Carlo, DORA — stay with the
consumer.

`statistics.ts` is therefore not implemented wholesale. Each contract is
reclassified against the rule before any implementation: metric-agnostic counts
grounded in configuration may qualify; anything carrying an operating-rule
choice (e.g. `GetBurndownData`) does not.

## Consequences

- stamm stays a **system of record**, not an analytics product. Its boundary is
  "observe faithfully," not "decide what good looks like."
- No opinionated metric definitions baked into the data layer means nothing
  rots when a definition is contested or evolves; consumers re-derive freely.
- Consumers (dashboards, services, generated AI clients) compute metrics from
  the exposed observations and own the operating rules. The same observation can
  feed steering and improvement measurement without conflict.
- Cost: metric logic may be duplicated across consumers, and large-scale
  derivations (e.g. a year of daily CFD) may eventually need a metric-agnostic
  rollup primitive in stamm. That is added reactively, gated by the two
  conditions above, and never as a named metric.
- The audit work that prompted this (recording selective change events, fixing
  destructive deletion to preserve events) is the *enabling* half: it makes the
  primary observations complete. This ADR fixes the *boundary* half: stamm stops
  there.
