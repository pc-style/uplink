# up!link

`up!link` is a minimalist MCP-native upload service for agents. It runs on Cloudflare Workers, stores files privately in R2, and returns Worker-signed download URLs through REST and MCP tools.

## Features

- Private R2 storage through the `UPLINK_BUCKET` binding.
- One shared API key for REST and MCP access.
- Worker-owned signed download URLs, temporary or permanent.
- Uploads through raw HTTP bodies, multipart forms, JSON `{ filename, encoding, content }`, temporary signed PUT URLs, remote URL ingestion, and MCP tool calls.

## Setup

```sh
bun install
bunx wrangler r2 bucket create uplink-files
bunx wrangler secret put UPLINK_API_KEY
bunx wrangler secret put UPLINK_SIGNING_SECRET
bunx wrangler types
```

For local development, create `.dev.vars`:

```dotenv
UPLINK_API_KEY=local-dev-key
UPLINK_SIGNING_SECRET=local-signing-secret
```

Run locally:

```sh
bun run dev
```

Deploy:

```sh
bun run deploy
```

## REST API

All `/api/*` routes require either `Authorization: Bearer <UPLINK_API_KEY>` or `x-api-key: <UPLINK_API_KEY>`.

### JSON Upload

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

For binary data, send `"encoding": "base64"`. JSON payloads default to a conservative 1 MiB limit (`UPLINK_MAX_JSON_BYTES`) because Workers should not buffer unbounded request bodies.

### Raw Upload

```sh
curl -sS https://uplink.example.workers.dev/api/upload \
  -H "Authorization: Bearer $UPLINK_API_KEY" \
  -H "x-filename: artifact.bin" \
  -H "content-type: application/octet-stream" \
  --data-binary @artifact.bin
```

### Multipart Upload

```sh
curl -sS https://uplink.example.workers.dev/api/upload \
  -H "Authorization: Bearer $UPLINK_API_KEY" \
  -F "file=@artifact.bin" \
  -F "permanent=true"
```

### Temporary PUT URL

```sh
curl -sS https://uplink.example.workers.dev/api/upload-url \
  -H "Authorization: Bearer $UPLINK_API_KEY" \
  -H "content-type: application/json" \
  --data '{"filename":"artifact.bin","contentType":"application/octet-stream"}'
```

The response includes a signed `uploadUrl` that accepts `PUT` without the main API key.

### Ingest from URL

```sh
curl -sS https://uplink.example.workers.dev/api/ingest-url \
  -H "Authorization: Bearer $UPLINK_API_KEY" \
  -H "content-type: application/json" \
  --data '{"url":"https://example.com/signed-source-url","filename":"artifact.bin"}'
```

This is useful when agents can place a file in Azure Blob, DigitalOcean Spaces, GitHub artifacts, or any other short-lived URL but cannot upload directly from a filesystem.

## MCP

The remote MCP endpoint is:

```text
https://uplink.example.workers.dev/mcp
```

MCP requests require the same bearer token or `x-api-key` header. Tools:

- `upload_file`
- `upload_text`
- `upload_from_url`
- `create_upload_url`
- `create_download_url`
- `get_file_info`

For clients that need a local proxy, use `mcp-remote` and configure headers according to that client/proxy’s supported environment variables or command-line options.

## Verification

```sh
bun run typecheck
bun test
bun run check
```
