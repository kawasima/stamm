# 3. Custom fields are Schema-on-Write EAV

- Status: Accepted
- Date: 2026-06-17

## Context

Custom fields are modeled in two halves, and only one half exists in practice.
The **values** (`CustomFieldValue = {fieldId, value}`) are written through
`issue_update`'s `customFields` and stored as a JSON-text column on the issue.
The **definitions** (`CustomFieldDefinition` — name, type, constraints, scope,
possible values, required) have a schema and behavior contracts (CRUD) but no
table, no implementation, no tool, and no `admin_*` entry. Dogfooding surfaced
the gap: a consumer can write `customFields`, but there is no registry the
`fieldId` comes from and nothing checks the value.

Custom fields are the runtime-user-defined case of attribute modeling — EAV
(entity-attribute-value), the Redmine-style "users define fields at runtime."
In a [flexibility/generality model](https://scrapbox.io/kawasima/柔軟性と汎用性)
where flexibility = P × I (postcondition strength × implementation-independence)
and generality = D × I (input-domain breadth × implementation-independence), EAV
is a way to widen the domain D: new fields are added as **data**, not as code or
schema migrations.

A widened domain only stays *flexible*, though, if the postcondition P is
preserved across the whole of it. Today stamm has widened D — any `fieldId` and
any `value` are accepted into the JSON blob — without preserving P: nothing
checks that a value matches its field's declared type, constraints, or scope.
That is exactly the `Map<String, Object>` / `JSON.parse → any` degradation: the
provider promises only "some attribute bag," so readers must interpret the
structure themselves and break when it drifts. EAV that keeps the domain but
drops "which attribute must be which type" lands in this weak-contract case
rather than in the flexibility it was reached for.

stamm persists records, and a record should be valid. stamm is **Schema on
Write**, not Schema on Read: it does not store opaque values and defer
interpretation (and the cost of being wrong) to readers.

## Decision

Custom fields are **Schema-on-Write EAV**. Two parts:

1. **A definition registry.** `CustomFieldDefinition` gets a table, a Raoh-style
   codec (JSON columns for `possibleValues` / `constraints` / `scope`), a CRUD
   implementation wiring the existing behavior contracts, and exposure as a
   `custom_field` resource under the `admin_*` tools, gated by the existing
   `custom_field.manage` permission. A consumer can now discover which fields
   apply to a project / issue type and render inputs for them.

2. **Write-boundary validation.** On `issue_create` / `issue_update`, each
   `CustomFieldValue` is decoded against its definition (parse-don't-validate,
   the same boundary discipline used elsewhere): the `fieldId` resolves to a
   definition, the `value` conforms to its `fieldType` (including `list` /
   `multi_list` membership in `possibleValues` and `user` / `version` references
   resolving), the `constraints` hold (`regexp`, min/max length, min/max value),
   and the field is in scope for the issue's project / type. Invalid values are
   rejected at the boundary. A stored custom-field value therefore always
   conforms to its definition, and readers get a strong contract (P) over the
   widened domain (D) — custom fields stay on the flexibility side instead of
   collapsing to the generic-map case.

Values stay in the issue's JSON-text column (the definition registry is a normal
table; only the *definitions* are normalized, not the values). They are
validated on the way in but not promoted to a normalized `(issue_id, field_id,
value)` table. The present need for the values is metrics, which read them
alongside the issue, not heavy filtering/joining — so the EAV costs that a
normalized table would cheapen (referential-integrity and usage checks, querying
by value) are paid as JSON scans when needed. Normalizing is a later option if
query load demands it; the write-side contract above does not depend on the
storage shape.

This is consistent with ADR-0001 and ADR-0002: stamm is a system of record, and
a faithful record here means a validated one. Schema on Read — storing opaque
attribute bags and validating (or not) on the way out — is explicitly not
chosen; a team that wants that models it outside stamm.

## Resolved sub-decisions

These are the EAV costs *SQL Antipatterns* names — type enforcement, required
validation, referential integrity, query expression — surfaced as concrete
choices and settled.

1. **Required (`isRequired`) enforcement timing.** *Decided:* enforce going
   forward, at write time. Making a field required does not retroactively
   invalidate existing issues that lack it; back-filling is a migration concern,
   not a write-time failure.

2. **Definition deletion with existing values.** *Decided:* forbid deleting a
   definition that is still in use (some issue holds a value for it); the values
   must be cleared first. The definition stays a timeless `Resource` — no
   archive/lifecycle state for now. The reason deletion is guarded here, unlike
   other config resources which delete freely and leave a dangling id, is that a
   custom-field definition is *constitutive* of its values: it is what gives a
   stored value its type and meaning, so deleting it would void the very
   postcondition this ADR establishes (an orphaned `5` is no longer known to be
   an integer-with-max-100). A dangling `statusId`, by contrast, is incidental —
   the issue's state is still coherent without the status row. Because values
   live in the issue JSON column, "is this field in use?" is a scan over issues'
   `custom_fields`, not an FK lookup; that cost is accepted. (Revisit an archive
   lifecycle only if retire-with-history becomes a real need.)

3. **Scope checking on write.** *Decided:* validate that the `fieldId` is in
   scope (`projectIds` / `issueTypeIds`) for the issue being written; an
   out-of-scope value is rejected. Scope is part of the definition, so it is part
   of the contract — leaving it advisory would make it decoration rather than a
   postcondition.

## Consequences

- Stored custom-field values carry a strong contract; consumers can rely on a
  value matching its definition without re-validating.
- The definition registry closes the loop the value path left open: a generated
  client can enumerate a project/type's fields and build a form.
- Cost: the issue write path gains a definition lookup and validation logic, and
  filtering/searching by custom value over a JSON column is more work — deferred
  until needed, with `isFilter` / `isSearchable` marking where it is wanted.
- Schema on Read is foreclosed for custom fields; opaque attribute bags belong
  outside stamm.
