# up!link CLI

A fully functional command-line interface for the up!link Cloudflare R2 file upload service.

## Quick Start

### Build

```bash
cd cli
bun install
bun run build
```

This creates a standalone executable `uplink` in the `cli/` directory.

### Install

```bash
# Copy to PATH
sudo cp cli/uplink /usr/local/bin/uplink

# Or use a symlink
ln -s $(pwd)/cli/uplink /usr/local/bin/uplink
```

### Configure

```bash
uplink auth set --key YOUR_API_KEY
```

Keys shaped `uplink_<host>_<secret>` embed the server address. For legacy keys, add `--server https://your-server.com`:

```bash
uplink auth set --server https://your-server.com --key YOUR_API_KEY
```

### Upload a File

```bash
uplink upload ./myfile.txt
uplink upload --short ./myfile.txt
uplink upload --file ./myfile.txt --filename myfile.txt
```

## Commands

- `auth` - Manage authentication (set/show/clear credentials)
- `upload` - Upload a file via multipart/form-data
- `upload-url` - Create a signed upload URL for clients
- `ingest` - Fetch and store a remote URL
- `sign` - Create a signed download URL for existing files
- `info` - Get file metadata
- `download` - Download a file (from signed URL or by key)
- `sync` - Push or pull a whole directory through a manifest

## Architecture

- **Language**: TypeScript (Bun runtime)
- **Build**: Bundled with `bun build --target bun` + shebang
- **Config**: `~/.config/uplink/config.json`
- **Auth**: Bearer token (API key) for all `/api/*` endpoints
- **Signed URLs**: HMAC-SHA256 signed tokens for download/upload URLs

## API Coverage

All up!link REST API endpoints are supported:
- `POST /api/upload` - Multipart/form-data upload
- `POST /api/upload-url` - Create signed PUT URL
- `POST /api/ingest-url` - Ingest remote URL
- `POST /api/sign` - Create signed download URL
- `GET /api/files/:key` - Get file info
- `GET /d/:token` - Download via signed token
- `GET /s/:id` - Short-link redirect to a signed download URL
- `PUT /u/:token` - Upload via signed token

## Directory sync

For private project assets that should not live in git, push a directory and commit only the generated manifest:

```bash
uplink sync push --dir assets --manifest data/uplink-assets.json
```

On another machine or remote environment, restore the files from that manifest:

```bash
uplink sync pull --dir assets --manifest data/uplink-assets.json
```

By default `sync` includes common media files. Add `--all` to include every regular file.
