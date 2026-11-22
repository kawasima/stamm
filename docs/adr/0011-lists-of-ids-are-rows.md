# 11. Lists of ids are rows, and a draft ends when it becomes an issue

- Status: Accepted
- Date: 2026-11-22

## Context

[0008](0008-the-database-guards-references.md) left ids inside JSON unguarded. A
template could name another project's label; a version or user held as a field value
could be deleted, after which the issue could not even be saved as it was. And for
some lists empty means all: anyone may make a transition without roles, a field
without projects applies everywhere. Cleaning a vanished id out of such a list could
turn "only there" into "everywhere".

A draft, which lasts until it is promoted, stayed after its promotion and could be
promoted again.

## Decision

**A list of ids that is part of a row is kept as rows with foreign keys**: a
transition's roles, where a field applies, a template's labels and assignees. Values
still carry the lists; only storage changed.

- A listed role, project or issue type can't be deleted while it is listed, so a list
  that limits something never becomes shorter by itself.
- A template's labels and assignees are suggestions and go with what they name, or
  when the person leaves the project. What a template fills in is checked when it is
  written; field values are offered only while they apply.

**What stays JSON, and why.**

- Field values (ADR-0003). A version or user that one holds can't be deleted, and a
  version is one of the issue's project. The check and the write share a transaction.
- A view's filter is a question. An id that is gone matches nothing.
- A key's projects. One that is gone opens nothing, and it must not be removed, for
  the reason above.

**Conversion removes the draft** in the same transaction. Its text is the issue's and
the conversion Event remains.

**A private view is its owner's.** Nobody else makes, changes, or deletes it, apart
from a global admin.

What the actor can't see gets exactly the error of what does not exist, for reads and
writes of anything in a project. The tests compare the two.

## Consequences

- A project that a custom field is limited to can't be deleted until the field is
  changed or removed.
- The migration stops, changing nothing, if a limiting list names only things that
  are gone, because someone has to say what it should mean.
