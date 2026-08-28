# up!link

Agents and remote development environments often need to move an artifact without committing it to a repository or making an object-storage bucket public. `up!link` is a small, self-hosted Cloudflare Worker that accepts authenticated uploads, stores them in a private R2 bucket, and returns signed download links. It exposes REST and MCP interfaces and includes a Bun-based CLI.

## Status

**Early-stage / experimental.** The package and CLI report version `0.1.0`. The repository has tests and type checks, but no published releases or CI workflow. There is no verified public up!link Worker or hosted demo; deploy your own instance and evaluate it with non-sensitive data before relying on it. Interfaces and storage behavior may change without a migration path.

## Demo / smoke test

After deploying, the unauthenticated root endpoint provides a minimal readiness response:

```sh
curl https://uplink.<your-subdomain>.workers.dev/
```

It returns JSON describing the service and its endpoints. Upload and file-information routes require the deployment's API key. The included agent skill is discoverable with `bunx --bun skills add pc-style/uplink --list`, but it is not a hosted upload service.

## Quickstart

If someone has already deployed an up!link Worker and handed you a key shaped `uplink_<host>_<secret>`, setup is two commands — the key embeds the server address, so no URL configuration is needed:

```sh
bunx skills add pc-style/uplink
export UPLINK_API_KEY=uplink_<host>_<secret>
```

Your agent can now upload files and mint links. The CLI works off the same single variable, or persist it with `uplink auth set --key <api-key>`.

Operators generate these keys during [Self-hosting](#self-hosting) with `bun run make-key <deployment-url>`. Legacy keys without the `uplink_` prefix still work; clients then also need `UPLINK_BASE_URL` (skill) or `UPLINK_SERVER` (CLI).

## Install

Choose one of these paths:

- **Service:** follow [Self-hosting](#self-hosting) to deploy the Worker and R2 bucket to your Cloudflare account.
- **Agent skill:** run `bunx skills add pc-style/uplink` for a compatible coding agent.
- **CLI:** inspect [`install.sh`](install.sh), then run `curl -fsSL https://install.pcstyle.dev/uplink.sh | bash`; or build it from the cloned source as described under [CLI](#cli).

## Features

- Private R2 storage through the `UPLINK_BUCKET` binding.
- One shared API key for REST and MCP access.
- Worker-owned signed download URLs, temporary or permanent.
- Uploads through raw HTTP bodies, multipart forms, JSON `{ filename, encoding, content }`, temporary signed PUT URLs, remote URL ingestion, and MCP tool calls.

## Trust and privacy

- The operator controls the Cloudflare account and R2 bucket. Uploaded file bodies are stored in that bucket; filenames, timestamps, content types, and supplied metadata are stored with objects. URL ingestion also records the source host.
- API routes use one shared bearer API key. Anyone with that key can upload, inspect object metadata, and create links. The CLI stores the server and API key as JSON at `~/.config/uplink/config.json`; protect that file and prefer environment variables on shared systems.
- Signed upload and download URLs are bearer credentials. Anyone who receives one can use it until it expires. A “permanent” link has no expiry; rotating `UPLINK_SIGNING_SECRET` invalidates existing signed links.
- The default Wrangler configuration enables Cloudflare observability with full head sampling. Review Cloudflare's logging, retention, data-location, and R2 policies for your account before uploading sensitive data.
- This repository provides no delete endpoint or automated retention policy. Bucket lifecycle rules and deletion are the operator's responsibility.
- `ingest-url` makes an outbound request from the Worker to a caller-supplied HTTP(S) URL. Only give the API key to callers you trust with that capability.
- The installer downloads the current `main` branch and builds it locally; it is not pinned to a release or commit. Review the script/source or install from a pinned checkout when reproducibility matters.

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

Generate the binding types, run the checks, and deploy:

```sh
bunx wrangler types
bun run typecheck
bun test
bun run deploy
```

Wrangler prints the deployment URL, normally `https://uplink.<your-subdomain>.workers.dev`. Generate the API key from that URL — the key embeds the host so clients need nothing else — and set it as the Worker's `UPLINK_API_KEY` secret, pasting the printed key when prompted:

```sh
bun run make-key https://uplink.<your-subdomain>.workers.dev
bunx wrangler secret put UPLINK_API_KEY
```

Generate a second, independent secret for `UPLINK_SIGNING_SECRET`; it is only used by the Worker to sign upload and download URLs:

```sh
openssl rand -hex 32
bunx wrangler secret put UPLINK_SIGNING_SECRET
```

Confirm the deployment is online, then hand out the `uplink_...` key for REST or MCP requests:

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

## Provenance

The canonical source is [github.com/pc-style/uplink](https://github.com/pc-style/uplink). The public installer endpoint currently serves this repository's [`install.sh`](install.sh), which downloads and builds `pc-style/uplink` from GitHub. No release binaries are published; the checked-in `cli/uplink` executable is generated JavaScript and can be rebuilt with `bun run --cwd cli build`.

## License

No license is granted for this repository. See [LICENSE](LICENSE). Public source availability does not by itself grant permission to use, copy, modify, or distribute the code.
