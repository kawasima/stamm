# 6. Issue history is complete, ordered, and listed per project

- Status: Accepted
- Date: 2026-11-22

## Context

[ADR-0001](0001-metrics-are-a-consumer-concern.md) has consumers derive metrics
from the typed change Events. A dashboard over an imported project of 1,531 issues
showed that they could not do so faithfully.

- The Events were readable one issue at a time: 1,531 calls or more.
- `activity_list` is a bulk feed, but an entry does not say which status was
  entered. A consumer had to guess it from the current status.
- The initial status was not recorded. An issue's status before its first change
  was unknown until it changed, and unknown for good if it never did.
- Changes sharing an instant were ordered by random id.
- A deleted issue's Events were readable by a global admin only, so the series a
  project member reads had the silent holes ADR-0001 rules out.
- A status could be deleted while the history referred to it.

## Decision

**A fact is recorded once, in its typed Event.** The activity feed says that
something happened, to what, by whom and when. Its `changes` field, which nothing
ever wrote, is removed rather than filled with a copy of the Events.

**The status history starts at creation.** The first Event of an issue enters its
initial status and has no `fromStatusId`. Existing issues get theirs from what is
already recorded: the status the first change left, or the current one.

**Events of one issue have an order of their own.** A position within the issue's
history breaks ties of `occurredAt`. It is not exposed; listings are in order and
their cursors are opaque.

**`issue_change_list` returns the Events of a project** as one series tagged by
kind. A new kind of Event joins this listing instead of bringing a tool of its own.
It is a listing of observations: it aggregates nothing.

**History belongs to where the issue is.** A live issue's history is listed under
its current project, as a search lists the issue. A deleted issue's is listed under
the project it was deleted from, and is readable to a global admin and to members
with a role that sees every issue there, who could read it while it existed.

**A status that is referred to cannot be deleted.** Changing its category is still
allowed: categories are current configuration, and changing one reinterprets the
history on purpose.

**Issue visibility is stated once** (`src/impl/issue-visibility.ts`), as a SQL
condition used by every read of an issue or of something attached to one.

## Alternatives considered

- *Writing from/to into the activity entry.* Two records of one fact, the second
  untyped, with nothing to keep them equal.
- *A bulk variant of each history tool.* Three tools now, one more per future kind,
  and the consumer left to merge them in time order.
- *Storing the project on each Event.* An issue that moves would leave its history
  behind, and the two projects' series would disagree with a search of either.

## Consequences

- `issue_history` has one more entry, at the start. Counting entries into a status
  now includes creation in that status.
- The listing is ordered by when things occurred. Following its cursor is not a way
  to wait for new Events, since an import records Events in the past. If tailing is
  needed, an order of recording can be added behind the opaque cursor.
- Moves between projects are not themselves recorded as an Event, so a project's
  past size can't be reconstructed if issues have moved in or out.
