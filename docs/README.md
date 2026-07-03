# up!link docs

This directory documents the public API surface of **up!link**.

## What up!link exposes

- **REST API** for uploads, metadata, signed URLs, and ingestion.
- **MCP endpoint** for agent tooling.
- **Signed worker URLs** for temporary downloads and uploads.

## Authentication

The REST API and MCP endpoint use the same API key:

- `Authorization: Bearer <UPLINK_API_KEY>`
- or `x-api-key: <UPLINK_API_KEY>`

Signed download/upload URLs do **not** need the API key. They are authenticated by the signed token in the path.

## Docs

- [REST API](./rest-api.md)
- [MCP](./mcp.md)

## Environment variables

- `UPLINK_API_KEY` — shared API key for REST and MCP.
- `UPLINK_SIGNING_SECRET` — signs temporary and permanent worker URLs.
- `UPLINK_BUCKET` — Cloudflare R2 bucket binding.
- `UPLINK_DEFAULT_TTL_SECONDS` — default download URL lifetime, in seconds. Default: `3600`.
- `UPLINK_MAX_JSON_BYTES` — max size for JSON upload bodies. Default: `1048576` (1 MiB).
