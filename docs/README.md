# up!link docs

This directory documents the public API surface of **up!link**.

## What up!link exposes

- **REST API** for uploads, metadata, signed URLs, and ingestion.
- **MCP endpoint** (2026-07-28) for agent tooling, with API key or OAuth 2.1 auth.
- **Signed worker URLs** for temporary downloads and uploads.

## Authentication

The REST API and MCP endpoint accept the same API key:

- `Authorization: Bearer <UPLINK_API_KEY>`
- or `x-api-key: <UPLINK_API_KEY>`

The MCP endpoint also accepts OAuth 2.1 access tokens issued by the Worker itself. This is not a login system: the consent page asks for an API key, so tokens carry the same access as the key. See [MCP](./mcp.md#oauth).

Signed download/upload URLs do **not** need the API key. They are authenticated by the signed token in the path.

## Docs

- [REST API](./rest-api.md)
- [MCP](./mcp.md)

## Environment variables

- `UPLINK_API_KEY` — the static API key for REST and MCP. Extra named keys are minted with `bun run new-key` and verified with `UPLINK_SIGNING_SECRET`.
- `UPLINK_SIGNING_SECRET` — signs temporary and permanent worker URLs, MCP OAuth codes/tokens, and `new-key` API keys.
- `UPLINK_BUCKET` — Cloudflare R2 bucket binding.
- `UPLINK_DEFAULT_TTL_SECONDS` — default download URL lifetime, in seconds. Default: `3600`.
- `UPLINK_MAX_JSON_BYTES` — max size for JSON upload bodies. Default: `1048576` (1 MiB).
