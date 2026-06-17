# Showcase prompt — build a Scrum kanban board on stamm

stamm is headless: it ships the model and behavior of issue tracking over MCP and
leaves the UI to you. This page is a **prompt you paste into Claude Code** (in an
empty directory, with a stamm server running) to generate a working Scrum kanban
web app for a small team — no UI code is shipped in stamm itself.

The app connects **browser-direct** to the shared stamm server: each teammate's
browser is its own authenticated MCP client, signing its own short-lived tokens
with its own key. There is no backend-for-frontend and no server that custodies
everyone's keys.

---

## Before you run the prompt (one-time setup)

1. Have stamm built and running over HTTP on a fresh database:

   ```sh
   npm install && npm run build
   npm run http        # serves MCP over http://127.0.0.1:3000/mcp
   ```

   On first boot stamm seeds an admin and a member and writes their **private
   signing keys once** to `stamm-seed-keys.json` (mode 0600). Each entry has
   `{ userId, keyId, algorithm: "EdDSA", privateKey: <JWK> }`.

2. For a team, mint a key per teammate. As the admin (using the admin key), call
   the `admin_create` tool to add each user and `user_key_issue` to mint their
   key — the private JWK is returned exactly once. Hand each teammate their
   `{ userId, keyId, privateKey }`. (For a quick demo, the two seeded users are
   enough.)

3. Keep these private keys secret and serve the app behind TLS in real use. A
   key is the authority to act as its user.

---

## The prompt

> Build a Scrum kanban web app for a 3-person team on top of a running stamm MCP
> server. stamm is a headless project-management system; you talk to it over the
> Model Context Protocol. Do not modify stamm — build only the client app.
>
> ### Connection and authentication (this is the core of the showcase)
>
> - The app is a **static SPA** that talks **directly** to stamm's HTTP MCP
>   endpoint. Use a **Vite dev server that proxies `/mcp` to the stamm server**
>   (`http://127.0.0.1:3000`) so the SPA and `/mcp` share an origin — no CORS, no
>   backend of your own.
> - stamm authenticates **per user** with EdDSA (Ed25519) JWTs. Each user holds a
>   private signing key (a JWK issued by stamm). On every request the client
>   signs a **short-lived** JWT and sends it as `Authorization: Bearer <jwt>`.
>   The server pins the operating user to the token's `sub`, so identity is
>   per-person: assignees, "who moved this", and notifications are all real.
> - **Key handling (do this exactly):** on first login the user pastes their
>   issued private JWK once. Import it into WebCrypto as a **non-extractable**
>   key and persist the resulting `CryptoKey` in **IndexedDB**; then discard the
>   raw JWK. After that the raw key material never exists in JS again — the app
>   can sign with the key but cannot read it back out, so XSS or device theft
>   cannot exfiltrate it. Use `jose`:
>
>   ```js
>   import { importJWK, SignJWT } from "jose";
>   // provision once — extractable:false; store the returned CryptoKey in IndexedDB
>   const signingKey = await importJWK(privateJwk, "EdDSA", { extractable: false });
>   // per request — a fresh 5-minute token (server requires exp + iat, caps age at 15m)
>   const token = await new SignJWT({})
>     .setProtectedHeader({ alg: "EdDSA", kid })
>     .setSubject(userId).setIssuedAt().setExpirationTime("5m")
>     .sign(signingKey);
>   ```
>
> - **MCP client (use a thin fetch client — recommended):** the stamm server is
>   **stateless** and accepts a lone `tools/call` with **no `initialize`
>   handshake**, so you do not need the MCP SDK in the browser; a thin client is
>   simpler and avoids SDK bundle issues. Per logical operation, sign a **fresh**
>   token, then `POST /mcp` with headers `Authorization: Bearer <jwt>`,
>   `Content-Type: application/json`, `Accept: application/json, text/event-stream`
>   and body `{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
>   "name", "arguments" } }`. **The response is always Server-Sent Events**
>   (`Content-Type: text/event-stream`) even for a single call — read the body as
>   text and parse the JSON-RPC result out of the `data:` line; do **not** call
>   `res.json()`. Unwrap the tool result from `result.structuredContent` (or
>   `result.content`). (The SDK's `StreamableHTTPClientTransport` also works if you
>   prefer it — inject a fresh token via request headers per call — but it buys
>   nothing here since there is no session to maintain.)
>
> ### What to build (practical Scrum minimum)
>
> - **Board** with three columns derived from stamm's status **categories**
>   (`todo` / `in_progress` / `done`). Get the statuses from
>   `admin_list` with `{ params: { resource: "status", pagination: { limit: 100 } } }`
>   and group them by `category`.
> - **Cards** are issues showing title (`subject`), assignee, and priority. Load
>   them with `issue_search` (`{ filter, pagination, include: ["assignees","schedule"] }`).
> - **Drag a card** between columns to change its status. Status changes go
>   **only** through `issue_transition` (`{ issueId, toStatusId }`), which is
>   workflow-gated — never set status via `issue_update`. Read
>   `issue_available_transitions` for the card's allowed targets so you only offer
>   legal moves.
> - **Create / edit a card** with `issue_create` and the compound `issue_update`
>   (subject, `assigneeIds`, `priorityId`, `iterationId`).
> - **Sprint switch**: list sprints with `iteration_list` (`{ projectId,
>   pagination }`) and filter the board by `iterationId`. The **Backlog** is
>   issues with no iteration — note there is no server-side "no iteration" filter,
>   so fetch the issues and partition by iteration membership **client-side**.
> - Resolve the project with `project_get_by_identifier` (`{ identifier:
>   "default" }`); populate dropdowns from `admin_list` (`user`, `priority`,
>   `issue_type`) — reads are open to members.
>
> ### Structure
>
> Keep clear unit boundaries: a `keystore` module (provision / load / sign), a
> `stammClient` module (typed wrappers over the MCP tools the board needs), board
> UI components, and an app shell with a login screen (paste-key → provision).
>
> ### Stack
>
> Vite + React + TypeScript, `jose`, `@modelcontextprotocol/sdk`, and a small
> drag-and-drop approach (HTML5 DnD or a light library). Adjust if you have a
> better fit, but keep the connection/auth design above.
>
> ### Acceptance criteria
>
> 1. A teammate logs in by pasting their issued private JWK once; reloading the
>    page keeps them logged in (key persisted in IndexedDB) without re-pasting.
> 2. The board shows real issues from stamm in the correct columns by status
>    category, filtered by the selected sprint (or Backlog).
> 3. Creating a card adds an issue in stamm; dragging a card moves it through the
>    workflow (`issue_transition`) and the change persists across reload.
> 4. Two different teammates (two keys) see their own identity reflected — e.g.
>    an assignee set by one is visible to the other, and actions are attributed
>    to the acting user.
> 5. No private key is ever stored in plain text or sent anywhere except as a
>    signed JWT to stamm.

---

## Notes

- **Browser support:** signing Ed25519 in WebCrypto requires a current browser
  (2025+). This is the constraint that makes the non-extractable-key design
  possible; verify it in your target browsers.
- **Why browser-direct:** it matches stamm's model — one shared server, each
  person their own client and identity, no middleman holding secrets. The price
  is careful in-browser key handling, which the non-extractable-key flow above
  addresses.
- **Hosting beyond dev:** the Vite proxy gives same-origin during development.
  For deployment, put the static SPA and `/mcp` behind one origin with a reverse
  proxy (so there is still no CORS and no app backend), or enable CORS on the
  stamm HTTP server.
- stamm models no metrics; if you want burndown/velocity, derive them in the
  client from the read tools — see [metrics-cookbook.md](metrics-cookbook.md).
