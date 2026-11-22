# 9. Contracts are kept both ways

- Status: Accepted
- Date: 2026-11-22

## Context

A contract says what a tool takes and what it returns. Neither was held to.

- Out: whatever a behavior had loaded was sent. People attached to an issue came
  with their email, which everywhere else only they and admins may see.
- In: arguments were accepted and ignored. Issues sorted by priority came sorted by
  due date; a custom field filter, a status category and a user search filtered
  nothing; a category's default assignee was thrown away. Nothing said so, so a
  client drew conclusions from an answer to a different question.

## Decision

**A tool sends what its contract declares.** Results are parsed with the return
schema where they leave: undeclared fields are dropped, and a result that does not
fit is an error that names fields and not values. A person inside something else is
a `UserRef`, which has no email. A test lists the tools whose contract can carry one.

**A listing honours every argument it declares.** An argument that isn't implemented
is removed from the contract. Unused parameters fail to compile, and a test derived
from the contracts checks that each listing reads all of its arguments and that
configuration writes keep all of theirs.

**Listings share one implementation** (`src/impl/listing.ts`).

- An order is named and total. A cursor carries its order, and one from another order
  is refused, since continuing under it would skip and repeat rows without a sign.
- Text is matched literally and without regard to case. Rows without a value come
  last in either direction.
- Date bounds are whole days in UTC, both ends included.
- Things that have a `sortOrder` are listed in it. Notifications come newest first.
- An address can be searched or sorted by only by those who may see it.

## Consequences

- Cursors issued before this change are refused; a client starts again.
- `createdBefore`, `updatedBefore` and an activity's `occurredBefore` now include
  the day they name.
- A behavior that returns something its contract does not allow fails loudly.
