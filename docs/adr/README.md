# Architecture Decision Records

Records of significant architectural decisions for stamm, in
[Michael Nygard's format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
Each ADR is immutable once accepted; a later decision supersedes an earlier one
rather than editing it.

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-metrics-are-a-consumer-concern.md) | Metrics are a consumer concern; stamm exposes primary observations | Accepted |
| [0002](0002-stamm-is-an-issue-tracking-system-of-record.md) | stamm is an issue-tracking system of record; wiki, automation, and webhooks are out of scope | Accepted |
| [0003](0003-custom-fields-are-schema-on-write-eav.md) | Custom fields are Schema-on-Write EAV | Accepted |
| [0005](0005-every-contract-names-its-actor.md) | Every contract names its actor, and configuration is read under the same rules as issues | Accepted |
| [0006](0006-issue-history-is-complete-and-listed-in-bulk.md) | Issue history is complete, ordered, and listed per project | Accepted |
| [0007](0007-limits-by-key-and-by-failed-authentication.md) | Calls are limited by key, failed authentications by address | Accepted |
| [0008](0008-the-database-guards-references.md) | The database guards references | Accepted |
| [0009](0009-contracts-are-kept-both-ways.md) | Contracts are kept both ways | Accepted |
