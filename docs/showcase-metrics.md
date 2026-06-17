# Showcase prompt — build a flow-metrics dashboard on stamm

stamm is headless, and it deliberately computes **no** metrics: per
[ADR-0001](adr/0001-metrics-are-a-consumer-concern.md) it persists *primary
observations* (the status / schedule / estimation change histories, the activity
timeline, current issue state) and leaves derived metrics to whoever is steering
the work. This page is a **prompt you paste into Claude Code** to generate a
read-only analytics dashboard that does exactly that: it pulls the observations
over MCP and computes cycle time, throughput, a CFD, due-date slippage, and WIP
age **client-side**. No metric logic lives in stamm.

It is the read/analytics counterpart to [showcase-kanban.md](showcase-kanban.md)
(a write-heavy board). The recipes it implements are documented in
[metrics-cookbook.md](metrics-cookbook.md) and verified end to end by
[`sim/metrics.mjs`](../sim/metrics.mjs) — the dashboard is the cookbook made
visual.

---

## Before you run the prompt (one-time setup)

Same as the kanban showcase: have stamm built and running over HTTP, and hold a
user's issued private signing key. See
[showcase-kanban.md → Before you run the prompt](showcase-kanban.md#before-you-run-the-prompt-one-time-setup)
for the steps. A dashboard only **reads**, so any member key is enough — reads
are open to project members.

For a meaningful chart you need history to look at: run the dashboard against a
database that has some issues which have moved through statuses over time (an
existing project, or seed one). On an empty database every chart is correctly but
unhelpfully empty.

---

## The prompt

> Build a read-only flow-metrics dashboard web app on top of a running stamm MCP
> server. stamm is a headless project-management system; you talk to it over the
> Model Context Protocol. **stamm computes no metrics** — you compute them in the
> client from the observations it exposes. Do not modify stamm — build only the
> client app.
>
> ### Connection and authentication
>
> - The app is a **static SPA** that talks **directly** to stamm's HTTP MCP
>   endpoint via a **Vite dev-server proxy of `/mcp`** to the stamm server
>   (`http://127.0.0.1:3000`), so the SPA and `/mcp` share an origin — no CORS,
>   no backend of your own.
> - stamm authenticates **per user** with EdDSA (Ed25519) JWTs. On first load the
>   user pastes their issued private JWK once; import it into WebCrypto as a
>   **non-extractable** key, persist the `CryptoKey` in IndexedDB, and discard the
>   raw JWK. Per request, sign a fresh short-lived token and send it as
>   `Authorization: Bearer <jwt>`. This is identical to the kanban showcase — copy
>   its [key-handling block](showcase-kanban.md#the-prompt) verbatim.
> - **MCP calls:** the server is stateless and takes a lone `tools/call` with no
>   `initialize` handshake. `POST /mcp` with `Accept: application/json,
>   text/event-stream`; the response is **always** SSE — read it as text and parse
>   the JSON-RPC result out of the `data:` line, then unwrap
>   `result.structuredContent`. A thin fetch client is enough.
>
> ### The one rule that makes this honest
>
> Every number on screen is computed **in the client** from stamm's observations.
> You may not ask stamm for a metric — it has no such tool. For each chart, the
> *operating rules* (window, percentile, what "started" / "done" mean, the
> baseline due date) are **your** explicit choices; surface them in the UI so a
> viewer knows what they are looking at. Ground "started" / "done" in stamm's
> status **categories**, not in hand-picked status names.
>
> ### Observations to pull
>
> - **Status categories** — `admin_list` `{ params: { resource: "status",
>   pagination: { limit: 100 } } }`, grouped by `category` (`todo` /
>   `in_progress` / `done`). This is the only "started/done" definition you need.
> - **Issues** — `issue_search` `{ filter, pagination, include:
>   ["assignees","schedule"] }` (page through fully).
> - **Status history per issue** — `issue_history` `{ issueId, pagination }`
>   (chronological status transitions: `fromStatusId`, `toStatusId`,
>   `occurredAt`).
> - **Schedule history** — `issue_schedule_history` (typed `from→to` of
>   start/due dates).
> - **Estimation history** — `issue_estimation_history`, plus `time_summary` /
>   `time_list` for logged hours.
>
> ### Charts to build (compute each client-side)
>
> 1. **Cumulative Flow Diagram (CFD).** For a date range, for each day, the count
>    of issues in each status **category**. Reconstruct each issue's category on a
>    given day by replaying its `issue_history` up to that day (the last
>    transition on or before the day gives its status; map to category). Stack
>    `todo` / `in_progress` / `done` as areas over time.
> 2. **Cycle-time distribution.** Per issue: `started` = first transition into an
>    `in_progress`-category status, `completed` = first into a `done`-category
>    status, `cycle = completed − started`. Plot a histogram (or a scatter of
>    completion-date vs cycle) and show median and p85. Let the viewer pick the
>    percentile.
> 3. **Throughput run chart.** Count issues that entered a `done`-category status
>    per week (or month — make the window a control). One bar/point per bucket.
> 4. **Due-date slippage.** Per issue from `issue_schedule_history`: `slip = last
>    toDueDate − first toDueDate` (the first recorded due date is the commitment
>    baseline). Show a distribution and the worst offenders.
> 5. **WIP and aging.** Current `in_progress`-category issues (`issue_search`
>    `{ filter: { statusCategories: ["in_progress"] } }`); age each by `now −
>    started.occurredAt` from its history. Flag items past an age threshold you
>    expose as a control.
> 6. **Snapshot mix.** Current counts by status / priority / assignee from
>    `issue_search` (`filter` + `include`), bucketed client-side.
>
> ### Be honest about what is NOT computable
>
> Two metrics cannot be computed from what stamm records today, and the dashboard
> should say so rather than fake them (see
> [metrics-cookbook.md → roadmap](metrics-cookbook.md#material-roadmap-not-built-yet)):
> **per-assignee flow** (needs assignment history — only the current assignee set
> is stored) and **burndown with scope change** (needs milestone/iteration
> membership history — only current membership is stored). Show these as
> "unavailable — needs an observation stamm does not record yet", not as a
> guess.
>
> ### Structure and stack
>
> A `keystore` module (provision / load / sign), a `stammClient` module (typed
> read wrappers), a `metrics` module of **pure functions** (observations in,
> numbers out — unit-test these against fixtures so the math is checkable
> independent of the UI), and chart components. Vite + React + TypeScript, `jose`,
> and a charting library of your choice. Keep the connection/auth design above.
>
> ### Acceptance criteria
>
> 1. Logging in by pasting a key once, then reloading, keeps the session (key in
>    IndexedDB), and the app makes only **read** calls — it never writes to stamm.
> 2. The CFD, cycle-time, throughput, slippage, and WIP charts render from real
>    stamm data, and each chart names the operating rules it used (window,
>    percentile, started/done definition).
> 3. The `metrics` pure functions have unit tests over fixture histories that pin
>    at least cycle time, throughput, and slippage to expected numbers.
> 4. Per-assignee flow and scope-change burndown are shown as explicitly
>    unavailable, not approximated.
> 5. No private key is ever stored in plain text or sent anywhere except as a
>    signed JWT to stamm.

---

## Notes

- **Why this is the honest test of ADR-0001.** stamm exposes the observations and
  nothing else; if a full flow dashboard can be built entirely client-side, the
  "metrics are a consumer concern" boundary holds in practice, not just on paper.
  The recipes are verified by [`sim/metrics.mjs`](../sim/metrics.mjs); this
  showcase is their UI.
- **The CFD is the demanding one.** It needs per-day historical state, which you
  reconstruct by replaying `issue_history` — there is no "status as of date"
  tool, by design (the history is the source). Cache the replayed timeline
  client-side so you do not refetch per day.
- **Scale.** If a project grows large enough that paging `issue_search` to count
  is impractical, that is the exact scale signal ADR-0001 names for adding a
  metric-agnostic server-side count primitive — file it as friction (see below)
  rather than working around it silently.
- **Capturing friction.** stamm dogfoods its own backlog; when building against
  it surfaces friction (a missing observation, an awkward shape), file it as an
  issue in stamm's `stamm` project so the practice keeps improving the tool.
