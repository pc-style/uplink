# up!link

`up!link` is a minimalist MCP-native upload service for agents. It runs on Cloudflare Workers, stores files privately in R2, and returns Worker-signed download URLs through REST and MCP tools.

## Features

- Private R2 storage through the `UPLINK_BUCKET` binding.
- One shared API key for REST and MCP access.
- Worker-owned signed download URLs, temporary or permanent.
- Uploads through raw HTTP bodies, multipart forms, JSON `{ filename, encoding, content }`, temporary signed PUT URLs, remote URL ingestion, and MCP tool calls.

## Self-hosting

You need a [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers and R2 enabled, plus [Bun](https://bun.sh). Clone the repository and authenticate Wrangler with the Cloudflare account that should own the deployment:

```sh
git clone https://github.com/pc-style/uplink.git
cd uplink
bun install
bunx wrangler login
```

The default configuration deploys a Worker named `uplink` with an R2 bucket named `uplink-files`. If either name is already used in your Cloudflare account, change `name` or `r2_buckets[0].bucket_name` in `wrangler.jsonc`, then create the bucket:

```sh
bunx wrangler r2 bucket create uplink-files
```

Generate two independent secrets. Keep `UPLINK_API_KEY`; clients need it to authenticate. `UPLINK_SIGNING_SECRET` is only used by the Worker to sign upload and download URLs.

```sh
openssl rand -hex 32
bunx wrangler secret put UPLINK_API_KEY

openssl rand -hex 32
bunx wrangler secret put UPLINK_SIGNING_SECRET
```

Paste the corresponding generated value when each command prompts for it. Generate the binding types, run the checks, and deploy:

```sh
bunx wrangler types
bun run typecheck
bun test
bun run deploy
```

Wrangler prints the deployment URL, normally `https://uplink.<your-subdomain>.workers.dev`. Confirm it is online, then use the API key from above for REST or MCP requests:

```sh
curl https://uplink.<your-subdomain>.workers.dev/
```

### Local development

Create an untracked `.dev.vars` file with development-only values:

```dotenv
UPLINK_API_KEY=local-dev-key
UPLINK_SIGNING_SECRET=local-signing-secret
```

Run locally:

```sh
bun run dev
```

The local Worker uses Wrangler's local R2 storage, so local uploads do not affect the deployed bucket. Before submitting changes, run:

```sh
bun run typecheck
bun test
bun run check
```

## Agent skill

Install the up!link upload skill through [skills.sh](https://skills.sh/) so compatible coding agents can upload files and return signed links through the REST API:

```sh
bunx skills add pc-style/uplink
```

Add `--global` to make it available outside the current project. The skill uses only `curl` and expects `UPLINK_BASE_URL` and `UPLINK_API_KEY` in the agent's environment; it does not install the CLI or contain credentials.

## CLI

Install the `uplink` CLI globally for your user with the interactive installer:

```sh
curl -fsSL https://install.pcstyle.dev/uplink.sh | bash
```

The installer downloads the public repository, builds the CLI with Bun, and places `uplink` in `$BUN_INSTALL/bin` (normally `~/.bun/bin`). It uses [Gum](https://github.com/charmbracelet/gum) for the prompt and progress UI when Gum is available, with a plain terminal fallback. Bun, curl, and tar are required.

For a non-interactive install or a custom destination:

```sh
curl -fsSL https://install.pcstyle.dev/uplink.sh | bash -s -- --yes
curl -fsSL https://install.pcstyle.dev/uplink.sh | bash -s -- --install-dir ~/.local/bin
```

Configure the installed CLI against your deployment:

```sh
uplink auth set --server https://uplink.<your-subdomain>.workers.dev --key <api-key>
uplink auth show
uplink upload ./artifact.zip --permanent
```

To build and install manually instead, clone the repository and copy the generated executable into a directory on `PATH`:

```sh
git clone https://github.com/pc-style/uplink.git
cd uplink/cli
bun install
bun run build
install -m 0755 uplink ~/.bun/bin/uplink
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
