# MCP

## Endpoint

The MCP endpoint lives on the same Worker origin at:

```text
/mcp
```

Example:

```text
https://uplink.example.workers.dev/mcp
```

## Protocol version

The server speaks MCP **2026-07-28** (stateless: no `initialize`, per-request `_meta` envelope, `server/discover`). Clients that still send the 2025 handshake are served through the built-in legacy fallback, so older clients keep working.

## Authentication

Every `/mcp` request must carry one of:

- **API key** — `Authorization: Bearer <UPLINK_API_KEY>` or `x-api-key: <UPLINK_API_KEY>`. Same key as REST.
- **OAuth 2.1 access token** — `Authorization: Bearer <access_token>` issued by the Worker's built-in authorization server (below).

Requests without valid credentials get `401` with a `WWW-Authenticate: Bearer resource_metadata="…"` challenge, so MCP clients discover the OAuth flow automatically.

### OAuth

The Worker is both the MCP resource server and its own authorization server. There is no external identity provider and there are no user accounts: the consent page authenticates you with an API key, and the resulting access token is just a short-lived, audience-bound stand-in for that key. Use OAuth when the client cannot send headers; otherwise the API key alone is equivalent.

Discovery:

- `GET /.well-known/oauth-protected-resource/mcp` — protected resource metadata (RFC 9728)
- `GET /.well-known/oauth-authorization-server` — authorization server metadata (RFC 8414)

Endpoints:

- `GET /oauth/authorize` — consent page. "Logging in" means pasting the deployment's `UPLINK_API_KEY`; approving redirects back with `code`, `state`, and `iss`.
- `POST /oauth/token` — `authorization_code` (PKCE S256 required) and `refresh_token` grants. Form-encoded, public clients only.
- `POST /oauth/register` — dynamic client registration. Deprecated in the spec but kept for clients that still need it.

Rules:

- Scope is `uplink` (full access, same as the API key).
- The `resource` parameter (RFC 8707) must be `https://<host>/mcp`. Tokens are bound to that audience; a token minted for one deployment is rejected by another.
- Client IDs may be **Client ID Metadata Documents**: an `https://` URL with a path whose JSON echoes `client_id` and contains a `redirect_uris` array. This is the preferred way to identify a client. DCR client IDs are also accepted.
- Redirect URIs must be `https://`, `http://localhost`/`127.0.0.1`/`[::1]`, or a private dotted scheme (`com.example.app:/callback`).
- Access tokens live 1 hour, refresh tokens 30 days. Refresh tokens rotate on use.
- Codes and tokens are stateless and signed with `UPLINK_SIGNING_SECRET`; the Worker keeps no token state. Consequences: there is no per-token revocation, an authorization code stays valid for its 5-minute lifetime even after it has been exchanged (it is still useless without the client's PKCE verifier), and a rotated-out refresh token stays valid until its own expiry. Rotating `UPLINK_SIGNING_SECRET` invalidates every code and token at once (and every signed download/upload URL). Deployments that need single-use codes or true refresh rotation can add a KV/Durable Object replay store; that is intentionally not part of the default.

## What the MCP server does

The MCP server exposes upload and metadata tools backed by the same R2 storage and signed URL flow used by REST.

Returned tool results are JSON encoded inside a text MCP response.

## Tools

### `upload_file`

Upload a file payload to private R2 storage.

Input:

- `filename` required string
- `encoding` required: `base64` or `text`
- `content` required string
- `contentType` optional string
- `metadata` optional object
- `ttlSeconds` optional positive integer
- `permanent` optional boolean

Notes:

- Use `base64` for binary content.
- Use `text` for UTF-8 text.

Returns the same shape as `POST /api/upload`.

---

### `upload_text`

Upload UTF-8 text content to private R2 storage.

Input:

- `filename` required string
- `content` required string
- `contentType` optional string, default `text/plain; charset=utf-8`
- `metadata` optional object
- `ttlSeconds` optional positive integer
- `permanent` optional boolean

Returns the same shape as `POST /api/upload`.

---

### `upload_from_url`

Fetch a source URL and store the response body privately in R2.

Input:

- `url` required URL
- `filename` optional string
- `contentType` optional string
- `metadata` optional object
- `ttlSeconds` optional positive integer
- `permanent` optional boolean

Behavior:

- The URL must be reachable over HTTP or HTTPS.
- If `filename` is omitted, the tool uses the last URL path segment or `download.bin`.

Returns the same shape as `POST /api/ingest-url`.

---

### `create_upload_url`

Create a temporary signed `PUT` URL for constrained clients.

Input:

- `filename` required string
- `contentType` optional string
- `ttlSeconds` optional positive integer, default `900`

Returns:

```json
{
  "key": "uploads/pending/<uuid>-filename.ext",
  "method": "PUT",
  "uploadUrl": "https://uplink.example.workers.dev/u/<signed-token>",
  "expiresAt": "2026-05-06T12:49:56.000Z"
}
```

The returned `uploadUrl` does not require the API key.

---

### `create_download_url`

Create a signed download URL for an existing object.

Input:

- `key` required string
- `ttlSeconds` optional positive integer
- `permanent` optional boolean

Behavior:

- The object must already exist.
- If `permanent: true`, the URL does not expire.

Returns:

```json
{
  "key": "uploads/2026/05/06/uuid-note.txt",
  "url": "https://uplink.example.workers.dev/d/<signed-token>",
  "permanent": false,
  "expiresAt": "2026-05-06T13:34:56.000Z"
}
```

---

### `get_file_info`

Return metadata for an existing object without exposing bytes.

Input:

- `key` required string

Returns the same object metadata as `GET /api/files/:key`.

## Client setup

Clients that support remote OAuth only need the URL:

```text
https://uplink.example.workers.dev/mcp
```

The client will hit the `401` challenge, discover the authorization server, open the consent page, and you paste the deployment's API key once. No proxy is needed.

If your client supports custom headers but not OAuth, send the same API key used by REST as `Authorization: Bearer` or `x-api-key`.
