# REST API

Base URL: the deployed Worker origin.

Examples below use:

```text
https://uplink.example.workers.dev
```

## Authentication

All `/api/*` routes require one of:

- `Authorization: Bearer <UPLINK_API_KEY>`
- `x-api-key: <UPLINK_API_KEY>`

If the key is missing or invalid, the API returns `401`.

## Common response shapes

### Success errors

Most REST responses are JSON.

Error format:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Missing or invalid API key."
  }
}
```

### Status codes

- `200` / `201` — success
- `400` — invalid input
- `401` — missing/invalid API key
- `403` — invalid or expired signed token
- `404` — object or route not found
- `405` — wrong method
- `413` — JSON body too large
- `500` — unexpected server error

## Routes

### `GET /`

Health/info endpoint.

Response:

```json
{
  "name": "up!link",
  "status": "ok",
  "endpoints": [
    "/api/upload",
    "/api/upload-url",
    "/api/ingest-url",
    "/api/sign",
    "/api/files/:key",
    "/mcp"
  ]
}
```

---

### `POST /api/upload`

Upload content directly. The request format is chosen by `Content-Type`:

- `application/json` or `application/mcp+json` → JSON upload
- `multipart/form-data` → multipart upload
- anything else → raw upload

#### 1) JSON upload

Request body:

```json
{
  "filename": "note.txt",
  "encoding": "text",
  "content": "hello from an agent",
  "contentType": "text/plain",
  "metadata": {
    "source": "agent"
  },
  "ttlSeconds": 3600,
  "permanent": true
}
```

Fields:

- `filename` required string
- `encoding` optional: `text`, `utf-8`, `utf8`, or `base64`
- `content` required string
- `contentType` optional MIME type
- `metadata` optional object; values are stringified and stored as R2 custom metadata
- `ttlSeconds` optional temporary URL lifetime
- `permanent` optional boolean; if true, also returns a permanent download URL

Default JSON body limit: `UPLINK_MAX_JSON_BYTES` or `1 MiB`.

Binary payloads should use `encoding: "base64"`.

Example:

```sh
curl -sS https://uplink.example.workers.dev/api/upload \
  -H "Authorization: Bearer $UPLINK_API_KEY" \
  -H "content-type: application/json" \
  --data '{
    "filename": "note.txt",
    "encoding": "text",
    "content": "hello from an agent",
    "contentType": "text/plain",
    "permanent": true
  }'
```

#### 2) Multipart upload

Form fields:

- `file` required file
- `filename` optional override
- `metadata` optional JSON string
- `ttlSeconds` optional
- `permanent` optional (`"true"` to enable)

Example:

```sh
curl -sS https://uplink.example.workers.dev/api/upload \
  -H "Authorization: Bearer $UPLINK_API_KEY" \
  -F "file=@artifact.bin" \
  -F "permanent=true"
```

#### 3) Raw upload

Used when the `Content-Type` is not JSON or multipart.

Requirements:

- request body must exist
- filename must be provided via `x-filename` header or `?filename=...`

Optional query params:

- `ttlSeconds`
- `permanent=true`

Example:

```sh
curl -sS https://uplink.example.workers.dev/api/upload \
  -H "Authorization: Bearer $UPLINK_API_KEY" \
  -H "x-filename: artifact.bin" \
  -H "content-type: application/octet-stream" \
  --data-binary @artifact.bin
```

#### Response

`201 Created`

```json
{
  "key": "uploads/2026/05/06/uuid-note.txt",
  "filename": "note.txt",
  "size": 123,
  "contentType": "text/plain",
  "uploadedAt": "2026-05-06T12:34:56.000Z",
  "temporaryUrl": "https://uplink.example.workers.dev/d/<signed-token>",
  "permanentUrl": "https://uplink.example.workers.dev/d/<signed-token>",
  "expiresAt": "2026-05-06T13:34:56.000Z"
}
```

Notes:

- `temporaryUrl` is always returned.
- `permanentUrl` is only returned when `permanent: true`.
- The stored object key is date-scoped under `uploads/YYYY/MM/DD/...`.

---

### `POST /api/upload-url`

Create a temporary signed `PUT` URL for direct upload.

Request body:

```json
{
  "filename": "artifact.bin",
  "contentType": "application/octet-stream",
  "ttlSeconds": 900
}
```

Fields:

- `filename` required string
- `contentType` optional MIME type to store with the object
- `ttlSeconds` optional expiration, default `900` seconds

Response:

```json
{
  "key": "uploads/pending/<uuid>-artifact.bin",
  "method": "PUT",
  "uploadUrl": "https://uplink.example.workers.dev/u/<signed-token>",
  "expiresAt": "2026-05-06T12:49:56.000Z"
}
```

Use the returned `uploadUrl` with a `PUT` request. That signed URL does **not** require `UPLINK_API_KEY`.

Example:

```sh
curl -sS https://uplink.example.workers.dev/api/upload-url \
  -H "Authorization: Bearer $UPLINK_API_KEY" \
  -H "content-type: application/json" \
  --data '{"filename":"artifact.bin","contentType":"application/octet-stream"}'
```

Then:

```sh
curl -sS -X PUT "https://uplink.example.workers.dev/u/<signed-token>" \
  -H "content-type: application/octet-stream" \
  --data-binary @artifact.bin
```

---

### `POST /api/ingest-url`

Fetch bytes from a remote URL and store them privately in R2.

Request body:

```json
{
  "url": "https://example.com/file.bin",
  "filename": "file.bin",
  "contentType": "application/octet-stream",
  "metadata": {
    "source": "github"
  },
  "ttlSeconds": 3600,
  "permanent": true
}
```

Fields:

- `url` required HTTP/HTTPS URL
- `filename` optional; defaults to the last URL path segment or `download.bin`
- `contentType` optional; defaults to the upstream response `content-type`
- `metadata` optional object
- `ttlSeconds` optional temporary download URL lifetime
- `permanent` optional boolean

Example:

```sh
curl -sS https://uplink.example.workers.dev/api/ingest-url \
  -H "Authorization: Bearer $UPLINK_API_KEY" \
  -H "content-type: application/json" \
  --data '{"url":"https://example.com/signed-source-url","filename":"artifact.bin"}'
```

Response format is the same as `POST /api/upload`.

---

### `POST /api/sign`

Create a signed download URL for an existing object.

Request body:

```json
{
  "key": "uploads/2026/05/06/uuid-note.txt",
  "ttlSeconds": 3600,
  "permanent": false
}
```

Fields:

- `key` required object key
- `ttlSeconds` optional; defaults to `UPLINK_DEFAULT_TTL_SECONDS` or `3600`
- `permanent` optional boolean

Behavior:

- The object must already exist.
- If `permanent: true`, the signed URL does not expire.

Response:

```json
{
  "key": "uploads/2026/05/06/uuid-note.txt",
  "url": "https://uplink.example.workers.dev/d/<signed-token>",
  "permanent": false,
  "expiresAt": "2026-05-06T13:34:56.000Z"
}
```

---

### `GET /api/files/:key`

Return metadata for an existing object.

Example:

```sh
curl -sS "https://uplink.example.workers.dev/api/files/$(python - <<'PY'
import urllib.parse
print(urllib.parse.quote('uploads/2026/05/06/uuid-note.txt', safe=''))
PY)" \
  -H "Authorization: Bearer $UPLINK_API_KEY"
```

Response:

```json
{
  "key": "uploads/2026/05/06/uuid-note.txt",
  "size": 123,
  "etag": "...",
  "uploaded": "2026-05-06T12:34:56.000Z",
  "httpMetadata": {
    "contentType": "text/plain"
  },
  "customMetadata": {
    "filename": "note.txt",
    "uploadedAt": "2026-05-06T12:34:56.000Z"
  }
}
```

---

### `GET /d/:token`

Signed download URL.

Auth:

- No API key required
- Token is verified from the path
- Token must have `purpose: "download"`

Response:

- streams the R2 object body
- includes stored HTTP metadata
- sets `etag`, `content-length`, and `cache-control`

Cache behavior:

- expiring tokens: `private, max-age=60`
- permanent tokens: `private, max-age=300`

If the token is invalid or expired, the route returns `403`.

---

### `PUT /u/:token`

Signed upload URL.

Auth:

- No API key required
- Token is verified from the path
- Token must have `purpose: "upload"`

Requirements:

- request body is required
- `content-type` header is used when present

Response:

```json
{
  "key": "uploads/pending/<uuid>-artifact.bin",
  "filename": "artifact.bin",
  "size": 123,
  "contentType": "application/octet-stream",
  "uploadedAt": "2026-05-06T12:34:56.000Z"
}
```

If the token is invalid or expired, the route returns `403`.
