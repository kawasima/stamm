# 8. The database guards references

- Status: Accepted
- Date: 2026-11-22

## Context

Nothing declared which rows refer to which. Writes accepted ids of rows that did not
exist, or of another project's labels and milestones. Deletes removed rows that were
referred to: a priority in use, the author of an issue, a project with issues in it.
Deleting a private project took its visibility with it and left its issues, which
then counted as public.

Checking each write and each delete in the code is a list that has to be remembered
every time a table or a tool is added, and it races with other writers.

## Decision

**References are foreign keys**, with one of two rules.

- `restrict`, when the referring row has no meaning without what it refers to: what
  an issue is (project, type, priority, status, author), what happened (who did it,
  the statuses history names), assignments, the roles members hold, work in a project.
- `cascade`, when it is part of it or only links to it: an issue's current state, a
  tag on an issue, a project's configuration, a user's keys and memberships.

Events are not tied to the issue they are about, nor an activity entry to its
project: they outlive it ([0001](0001-metrics-are-a-consumer-concern.md)). A test
lists the columns that name a row without being a key, each with the reason, and
fails on any other.

**What a key can't say is said in one place** (`src/impl/references.ts`): what is
attached to an issue belongs to the issue's project, and nothing is placed under
itself. An issue that moves leaves what belongs to its old project behind.

**Refusals are translated in one place** (`src/impl/db-errors.ts`) into `Conflict`
("in use") and `Validation` ("refers to something that does not exist"), in terms of
the call and without table or column names.

The last active admin can't be deleted, demoted or deactivated.

## Consequences

- A project is deleted only when it has no issues, drafts or logged time. Archive it
  otherwise. A user with any history is deactivated, not deleted.
- The migration refuses a database that already has dangling references, names them,
  and changes nothing. SQLite can't add keys to a table, so it rebuilds the tables in
  one transaction.
- Ids inside JSON (a template's default labels, a view's filter) are not guarded. A
  template offers only the ones that still exist.
