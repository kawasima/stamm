# stamm

A headless project management system. There is no UI — stamm ships the **model**
and the **behavior** of issue tracking, and exposes them over the
[Model Context Protocol (MCP)](https://modelcontextprotocol.io) so that any
client (Claude Code, an editor, your own front end) can drive it. If you want a
UI, build the one you want on top of these tools.

The domain model is written in [Zod](https://zod.dev) first, drawing on
[Redmine](https://www.redmine.org), [GitHub Issues](https://github.com/features/issues),
and [Nulab Backlog](https://backlog.com).

## Layers

```
src/
  schema/    Zod schemas — the single source of truth for every entity and operation
  behavior/  Behavior contracts — the operations exposed over the domain (the interface)
  impl/      SQL-backed implementation (Kysely; runs on SQLite today, Postgres-portable)
  mcp/       MCP server that maps each behavior contract onto an MCP tool
  http/      Remote HTTP transport + per-user JWT (EdDSA) authentication
  bin/       Entry points — stdio (stamm-mcp) and remote HTTP (stamm-http)
```

Each behavior is a contract (input/output Zod schema) in `schema/`, an interface
in `behavior/`, and a Kysely-backed implementation in `impl/domains/`. The MCP
layer in `mcp/catalog.ts` wires most behaviors 1:1 onto tools; config-resource
CRUD (status, priority, label, issue type, category, role, user, group) is folded
into the generic `admin_*` tools, and issue satellites (assignees, labels,
watchers, schedule) are folded into the compound `issue_update` tool.

## Data model

Projects own issues. An issue carries a type, status, priority, optional
assignees, labels, category, milestone, iteration, parent/subtasks, relations,
comments, attachment references, and time entries. Status changes respect a
configurable workflow (allowed transitions per status set), and activity
produces notifications for watchers. Custom fields, wikis, views, automations,
and templates round out the model.

## Getting started

Requires Node.js (built and tested on a recent LTS).

```sh
npm install
npm run build      # tsc -p tsconfig.build.json → dist/
npm test           # vitest
```

The first run against a fresh database bootstraps an admin user, a member, a
default project, and a default issue type / priority / status, so the server is
usable immediately.

## Running the MCP server

stamm exposes the same tools over two transports. Run `npm run build` before
either — both run from `dist/`.

### Local (stdio) — single pinned user

For one local client (Claude Code on your machine, an editor):

```sh
npm run mcp        # node dist/bin/stamm-mcp.js
```

- `STAMM_DB` — path to the SQLite file (defaults to `./stamm.db`)
- `STAMM_ACTOR` — pinned user id to act as (defaults to the bootstrapped member)

To register stamm with a local MCP host, point it at the built entry point. The
included `.mcp.json` does this for Claude Code:

```json
{
  "mcpServers": {
    "stamm": {
      "command": "node",
      "args": ["dist/bin/stamm-mcp.js"],
      "env": { "STAMM_DB": "stamm.db" }
    }
  }
}
```

### Remote (HTTP) — multiple users, per-user authentication

Run one shared stamm and let each team member point their own client at it.
Identity is per request: clients authenticate with a JWT, and the server pins
the operating user to the token's subject — clients never send (or can spoof) a
user id.

```sh
npm run http       # node dist/bin/stamm-http.js
```

- `STAMM_DB` — sqlite file (defaults to `./stamm.db`)
- `STAMM_HTTP_PORT` — listen port (default `3000`)
- `STAMM_HTTP_HOST` — listen host (default `127.0.0.1`)
- `STAMM_HTTP_PATH` — MCP endpoint path (default `/mcp`)
- `STAMM_JWT_ISS` / `STAMM_JWT_AUD` — optional expected `iss` / `aud` claims

**Authentication.** Each user holds an Ed25519 keypair. The server stores only
the public key; the user keeps the private key and signs short-lived JWTs with
it (`alg: EdDSA`, `kid` = the key id, `sub` = their user id). On every request
the server looks up the subject's public key and verifies the signature.

A fresh database bootstraps an admin and a member and mints a key for each —
the private keys are printed to **stderr once, on first run**. Save them. To
mint keys for more users, an admin calls the `user_key_issue` tool (over either
transport); the private key is returned exactly once.

Sign a request token from an issued private JWK (using [jose](https://github.com/panva/jose)):

```js
import { importJWK, SignJWT } from "jose";

const key = await importJWK(privateJwk, "EdDSA");
const token = await new SignJWT({})
  .setProtectedHeader({ alg: "EdDSA", kid })
  .setSubject(userId)
  .setIssuedAt()
  .setExpirationTime("5m")
  .sign(key);
```

Then send it as a bearer token on the MCP endpoint:

```sh
curl -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"my-client","version":"0"}}}' \
     http://127.0.0.1:3000/mcp
```

MCP clients that support a remote (Streamable HTTP) server can connect by URL
with the same `Authorization` header. Requests without a valid token get `401`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run build` | Compile to `dist/` |
| `npm run check` | Type-check without emitting |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run mcp` | Start the MCP server over stdio (single pinned user) |
| `npm run http` | Start the MCP server over HTTP (per-user JWT auth) |
