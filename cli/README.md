# up!link CLI

A command-line interface for the up!link Cloudflare R2 file upload service.

## Installation

### Prerequisites

- [Bun](https://bun.sh) (for development)

### Build from Source

```bash
cd cli
bun install
bun run build
```

This creates a standalone executable `uplink` in the `cli/` directory.

### Install Globally

```bash
# Copy the executable to a directory in your PATH
sudo cp cli/uplink /usr/local/bin/uplink

# Or use a symlink
ln -s $(pwd)/cli/uplink /usr/local/bin/uplink
```

## Usage

### Configure Authentication

First, set your up!link server URL and API key:

```bash
uplink auth set --server https://your-uplink-server.com --key YOUR_API_KEY
```

View your current configuration:

```bash
uplink auth show
```

Clear saved credentials:

```bash
uplink auth clear
```

### Upload Files

**Upload a file (multipart/form-data):**

```bash
uplink upload ./myfile.txt
uplink upload --short ./myfile.txt
uplink upload --file ./myfile.txt --filename myfile.txt
```

**Options:**
- `<file>`: Path to upload, e.g. `uplink upload file.txt`
- `--file, -f <path>`: Path to the file to upload
- `--filename, -n <name>`: Override the stored filename
- `--content-type, -t <type>`: Content type (auto-detected if not set)
- `--ttl <seconds>`: Time-to-live for the temporary download URL (default: 3600)
- `--permanent, -p`: Also generate a permanent download URL
- `--short, -s`: Create a really short share URL (auto-expires in 7 days) and print only that URL
- `--custom-url <name>`: Use a custom short URL path (e.g. `uplink upload file.pdf --short --custom-url q4-report`). Works with `-p` for permanent custom shorts.
- `--copy, -c`: Copy the final URL to clipboard (respects `-s` / `--custom-url` priority, then `-p`, then temporary)
- `--json, -j`: Output result as JSON

### Create Signed Upload URL

Generate a temporary signed URL for clients to upload directly:

```bash
uplink upload-url --filename document.pdf --ttl 900
```

**Options:**
- `--filename, -n <name>`: Expected filename (default: upload.bin)
- `--content-type, -t <type>`: Expected content type
- `--ttl <seconds>`: Time-to-live for the upload URL (default: 900)
- `--json, -j`: Output result as JSON

### Ingest Remote Files

Download a file from a remote URL and store it in up!link:

```bash
uplink ingest --url https://example.com/file.pdf --filename file.pdf
```

**Options:**
- `--url, -u <url>`: Source URL to fetch (required)
- `--filename, -n <name>`: Override the stored filename
- `--content-type, -t <type>`: Override content type
- `--ttl <seconds>`: Time-to-live for the temporary download URL (default: 3600)
- `--permanent, -p`: Also generate a permanent download URL
- `--short, -s`: Create a really short share URL (auto-expires in 7 days)
- `--custom-url <name>`: Use a custom short URL name
- `--copy, -c`: Copy the resulting URL to the clipboard
- `--json, -j`: Output result as JSON

### Create Signed Download URL

Generate a signed download URL for an existing file:

```bash
uplink sign --key uploads/2024/01/15/abc123-filename.pdf
```

**Options:**
- `--key, -k <key>`: Object key (path) in storage (required)
- `--ttl <seconds>`: Time-to-live for the signed URL (default: 3600)
- `--permanent, -p`: Create a permanent (non-expiring) URL
- `--short, -s`: Also create a short share URL (7 days by default; permanent with -p)
- `--custom-url <name>`: Custom short name (e.g. `--custom-url q4-report`)
- `--copy, -c`: Copy the URL (or short URL) to clipboard
- `--json, -j`: Output result as JSON

### Get File Info

Retrieve metadata for a stored file:

```bash
uplink info --key uploads/2024/01/15/abc123-filename.pdf
```

**Options:**
- `--key, -k <key>`: Object key (path) in storage (required)
- `--json, -j`: Output result as JSON

### Download Files

**Download from a signed URL:**

```bash
uplink download --url https://your-server.com/d/eyJ...
```

**Download by key (auto-signs):**

```bash
uplink download --key uploads/2024/01/15/abc123-filename.pdf --output ./local-file.pdf
```

**Options:**
- `--url, -u <url>`: Full signed download URL
- `--key, -k <key>`: Object key (will create a signed URL first)
- `--output, -o <path>`: Output file path (defaults to filename or stdout)

### Sync a Directory

Push private assets without committing them to git:

```bash
uplink sync push --dir assets --manifest data/uplink-assets.json
```

Restore them in another checkout or remote environment:

```bash
uplink sync pull --dir assets --manifest data/uplink-assets.json
```

By default this includes common media files only. Use `--all` to include every regular file.

## Configuration

Credentials are stored in `~/.config/uplink/config.json`:

```json
{
  "server": "https://your-uplink-server.com",
  "apiKey": "your-api-key"
}
```

## Examples

### Upload and share a file

```bash
# Upload a file
uplink upload --file ./report.pdf --filename report.pdf --permanent

# Output includes a permanent URL that can be shared
```

### Create time-limited upload link

```bash
# Generate a signed upload URL valid for 15 minutes
uplink upload-url --filename photo.jpg --ttl 900

# Share the uploadUrl with clients
```

### Ingest and distribute

```bash
# Fetch a remote file and store it
uplink ingest --url https://example.com/data.csv --permanent

# Get the permanent URL for distribution
```

## Development

### Run in Development Mode

```bash
cd cli
bun run dev
```

### Run Tests

```bash
cd ../  # root of the project
bun test
```

### Type Check

```bash
cd cli
bun run typecheck
```

## API Reference

The CLI interacts with the up!link REST API:

- `POST /api/upload` - Upload a file
- `POST /api/upload-url` - Create a signed upload URL
- `POST /api/ingest-url` - Ingest a remote URL
- `POST /api/sign` - Create a signed download URL
- `GET /api/files/:key` - Get file metadata
- `GET /d/:token` - Download via signed token
- `PUT /u/:token` - Upload via signed token

## Troubleshooting

### "Missing or invalid API key"

Run `uplink auth set` to configure your credentials.

### "unauthorized"

Verify your API key is correct and matches the server's `UPLINK_API_KEY`.

### Compiled binary issues

If the compiled binary doesn't work, run the CLI directly with Bun:

```bash
bun run cli/src/index.ts --help
```

## License

MIT
