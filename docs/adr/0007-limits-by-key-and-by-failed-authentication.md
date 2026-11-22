# 7. Calls are limited by key, failed authentications by address

- Status: Accepted
- Date: 2026-11-22

## Context

One limit, requests per client address checked before authentication, served two
purposes and neither well.

- Everything behind a bridge, a proxy or a NAT shares an address, so a busy
  dashboard took an agent's budget.
- It counted HTTP requests. A JSON-RPC batch of 204 calls passed as one.
- Its fixed window let twice the limit through across a boundary.

## Decision

Two limits, each keyed by what is known when it applies.

- **After authentication, calls are counted per key.** A key is a client: one user
  may run several, and several share an address. A batch counts as the calls it
  holds, and one larger than a key may spend at once is refused outright (`413`).
- **Before authentication, only failures are counted, per address.** A caller whose
  requests succeed is never limited here. The attempt is charged first and refunded
  on success, so concurrent attempts can't overrun it.

A key that authenticated from an address in the last five minutes passes that
address's failure limit. Otherwise one client retrying a revoked key would lock out
everyone behind the same bridge. The exemption skips the limit, not the check.

Both are token buckets. Over any minute a key gets at most its rate plus its burst,
and the burst is a third of the rate. `429` carries `Retry-After`, which the bridge
passes on.

## Consequences

- The limits are per process. Sharing them between servers, or limiting raw traffic,
  is the job of the proxy in front.
- While an address keeps failing, a key not recently seen from it may have to wait
  for its first request to be tried.
- Behind a reverse proxy all callers have the proxy's address, so failures there are
  pooled. Calls are not, since they are counted by key.
