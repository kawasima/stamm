# 10. Reading comes before writing, and what holds keeps holding

- Status: Accepted
- Date: 2026-11-22

## Context

Issue reads were decided in one place ([0006](0006-issue-history-is-complete-and-listed-in-bulk.md)),
but not everything went through it.

- Writes asked for a permission only. A member whose role sees only their own issues
  could change, comment on, or delete any other, given its id.
- Logged time and board positions told of issues the reader could not see.
- Attachments on anything but an issue had no rule at all.
- Errors named the hidden issue something was attached to.
- Notifications went to watchers who had lost the right to read.

Other rules held when something was written and not after: an assignee is a member
until the membership goes; a field value fits its definition until that, the issue's
type, or its project changes.

## Decision

**Writing to an issue, or to anything on it, takes being able to read it** and then
the permission (`assertCanWriteIssue`). What can't be read is missing, for reads and
writes, and an error names nothing the caller did not.

**A thing on an issue is as visible as the issue.** Time entries follow its Events,
which outlive it; one's own entries stay one's own. Only issues carry attachments.
Progress and time are summed over what the reader can see.

**Who is notified is decided when it happens**, by who can read the issue then, and
not by the key that wrote.

**A change that would break what holds either carries it along or is refused.**
Leaving a project takes the member off its issues, on record. A move leaves tags,
which are the project's, and is refused when it would lose field values, which are
the issue's. A field definition can't change into one its stored values contradict.

**Each write is all or nothing.**

These are checked against every tool rather than a list of them: each read is called
with every id there is, for viewers who may see different parts, and searched for
what they may not; each write is tried on hidden issues, and made to fail at every
statement it executes. A new tool without arguments in those tests fails them.

## Consequences

- Moving an issue with project-specific field values takes clearing them first.
- Counts and sums differ between readers who see different issues.
