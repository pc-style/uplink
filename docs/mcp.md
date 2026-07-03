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

## Authentication

MCP requests use the same API key as the REST API:

- `Authorization: Bearer <UPLINK_API_KEY>`
- or `x-api-key: <UPLINK_API_KEY>`

If the key is missing or invalid, the endpoint returns `401`.

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

If your MCP client supports custom headers, send the same API key used by REST.

If the client cannot attach headers directly, use a local MCP proxy such as `mcp-remote` and configure that proxy to forward the API key.
