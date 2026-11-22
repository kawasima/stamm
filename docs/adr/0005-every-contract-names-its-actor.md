# 5. Every contract names its actor, and configuration is read under the same rules as issues

- Status: Accepted
- Date: 2026-11-22

## Context

Issues, comments, and milestones were read through contracts that take `actorId`,
so the permission layer could decide. Configuration was not: `ListLabels`,
`GetCustomFieldDefinition`, `ListWorkflowTransitions`, `GetIssueTemplate` and the
other configuration reads took no actor. Two consequences followed.

- Any authenticated user could read the labels, categories, custom fields,
  workflow, default statuses, and templates of a private project.
- A project-limited key could not be given these reads at all, because nothing
  could narrow them. Such a key therefore could not look up the status, priority,
  or issue type an issue needs, nor the login of someone to mention.

## Decision

**Every exposed contract requires `actorId`,** reads included. A test enumerates
the tool catalog and fails on one that does not. There is no exception list: a
read that needs no check still says who is reading.

Configuration falls into three groups by what it describes.

1. **Workspace vocabulary**: statuses, priorities, issue types, and custom fields
   that apply to every project. Any actor may read it. It names no project.
2. **Project configuration**: labels, categories, workflow, default statuses,
   templates, and custom fields limited to projects. Readable when the project is.
   What cannot be read is absent (`NotFound`), not forbidden. A custom field
   shared by several projects lists only those the reader can see.
3. **The directory**: users, groups, roles, account states. A project-limited key
   sees its own user and the members of its projects, and nothing else here.

A key's scope on `admin_*` is decided per resource, not per tool. Resources the
key may not touch are absent from the published input schema. The permission
layer enforces the same rule independently.

## Alternatives considered

- *A single tool returning a project's whole configuration.* It would have served
  the project-limited key while leaving the open reads open, and added a second
  way to read the same things.
- *Opening `admin_list` to project-limited keys as it was.* It would have widened
  the leak.

## Consequences

- In-process callers must say who is reading. Over an authenticated MCP
  connection the server supplies it, so clients see no change.
- A new configuration resource must be placed in one of the three groups before it
  can be exposed. Project-limited keys do not see it until it is allowlisted.
