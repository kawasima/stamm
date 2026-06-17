# 2. stamm is an issue-tracking system of record; wiki, automation, and webhooks are out of scope

- Status: Accepted
- Date: 2026-06-17

## Context

Three domains were modeled in `schema/` and given behavior contracts but never
implemented or exposed as tools: **wiki**, **automation**, and **webhooks**.
Their presence read as a roadmap — "coming soon" — and the README listed them as
"modeled but not yet exposed." Each was a standing invitation to grow stamm's
surface area.

[ADR-0001](0001-metrics-are-a-consumer-concern.md) already drew one boundary:
stamm is a system of record that persists metric-agnostic primary observations
and leaves derived, parameterized metrics to consumers. The same question
applies here — does each of these three belong inside an issue-tracking system
of record? Reusing one label ("consumer concern") for all three would be
imprecise: they fall outside for three different reasons.

## Decision

stamm's scope is the **model and behavior of issue tracking** — issues and their
satellites, workflow, the change-event timeline, projects, milestones,
iterations, the configuration that grounds them, and access control. The three
unexposed domains are removed (schema and behavior pruned, as `statistics.ts`
was under ADR-0001), each for its own reason:

- **Wiki is a different subdomain.** A wiki is versioned markdown pages with a
  hierarchy — a knowledge base. Nothing about it is issue-tracking-specific;
  Redmine and Backlog merely happen to bundle one. By strategic DDD it is a
  separate bounded context. Keeping it would make stamm two systems in one
  rather than one done well. This is not "the consumer can compute it" — it is
  "this is a different product."

- **Automation is consumer policy.** An automation rule is "when *trigger* and
  *condition*, do *action*" — a parameterized, opinionated choice that belongs
  to whoever steers the work, exactly the shape ADR-0001 kept out for metrics.
  The activity timeline is already exposed, so a consumer (often a generated
  client) can evaluate its own rules against it. stamm modeling rules would fix
  one opinion about what should happen, which is the consumer's call.

- **Webhooks are an integration/transport concern.** Outbound delivery on an
  event is reproducible by polling the already-exposed activity feed, and its
  semantics — retries, signing, ordering, back-pressure — are infrastructure,
  not the record. A system of record observes faithfully; it does not own a
  delivery pipeline.

The common thread is the one from ADR-0001: stamm grows surface area only for
capabilities that are intrinsic to issue tracking and that a consumer could not
reasonably reconstruct from the exposed model. Wiki fails the first test;
automation and webhooks fail the second.

## Consequences

- The scope is legible. "What stamm is" is issue tracking as a system of record;
  "what stamm is not" is now written down (ADR-0001 for metrics, this for the
  rest) rather than implied by half-present schema.
- No dead schema rots. Removed domains live in git history and can return if a
  decision is revisited; until then nothing reads as a half-kept promise.
- Consumers own these capabilities. A team that wants a wiki, automation rules,
  or webhook delivery builds or buys it alongside their generated client,
  driving stamm through the exposed issue model and activity feed.
- Cost: a consumer that wants tight issue↔wiki linking, or stamm-native rule
  execution, must integrate across a boundary instead of getting it in-process.
  That is the price of a system that stays one coherent thing. If a capability
  later proves intrinsic to issue tracking and irreproducible by consumers, it
  is admitted then, against the tests above — not pre-modeled on spec.
