---
name: uploading-with-uplink
description: Uploads local files, shares signed links, ingests remote URLs, and syncs private asset directories through a self-hosted up!link service. Use when a user asks to upload or share a file with up!link, create temporary or permanent download links, or restore assets from an up!link manifest.
compatibility: Requires a configured up!link CLI, or curl with UPLINK_BASE_URL and UPLINK_API_KEY set.
---

# Uploading with up!link

Use the `uplink` CLI when available. It stores credentials in the user's config, keeps the R2 bucket private, and returns signed URLs suitable for sharing.

## Before uploading

1. Check for the CLI with `command -v uplink`.
2. If present, run `uplink auth show`. This masks the API key.
3. If it is not configured, ask the user to run:

   ```sh
   uplink auth set --server https://<worker>.<subdomain>.workers.dev --key <api-key>
   ```

4. Never print, read back, commit, or include the API key in a response.
5. Confirm the source file exists before uploading. Preserve its basename unless the user asks for another name.

If the CLI is unavailable, use the REST fallback only when both `UPLINK_BASE_URL` and `UPLINK_API_KEY` are already set. Otherwise, tell the user what is missing rather than guessing credentials.

## Upload a local file

Default to a temporary signed URL:

```sh
uplink upload --file <path> --json
```

Use `--permanent` only when the user asks for a permanent link. Use `--short` for a seven-day short link, or `--custom-url <name>` when the user requests a specific short path.

```sh
uplink upload --file <path> --permanent --json
uplink upload --file <path> --short
uplink upload --file <path> --custom-url <name> --permanent
```

Return the resulting URL and say whether it is temporary, permanent, or short. Do not dump the complete JSON unless the user requests it.

## REST fallback

Upload a file as multipart data without exposing the API key in the command output:

```sh
curl -sS --fail-with-body \
  "$UPLINK_BASE_URL/api/upload" \
  -H "Authorization: Bearer $UPLINK_API_KEY" \
  -F "file=@<path>" \
  -F "permanent=false"
```

The response includes `temporaryUrl`; a permanent upload also includes `permanentUrl`.

## Ingest an existing URL

Use ingestion when the bytes are already available at an HTTP or HTTPS URL:

```sh
uplink ingest --url <source-url> --filename <filename> --json
```

Add `--permanent` only when requested.

## Download or inspect a stored object

```sh
uplink info --key <object-key> --json
uplink download --key <object-key> --output <path>
uplink download --url <signed-url> --output <path>
```

## Sync private assets

Push a directory and write a manifest that can be committed without committing the assets:

```sh
uplink sync push --dir <directory> --manifest <manifest.json>
```

By default, sync includes common media files. Add `--all` only when every regular file should be included. Restore files in another checkout with:

```sh
uplink sync pull --dir <directory> --manifest <manifest.json>
```

Before pushing, check the manifest for unexpected paths and confirm it contains no credentials. Never commit the up!link credential file from `~/.config/uplink/config.json`.

## Failure handling

- `401`: authentication is missing or the configured API key does not match the Worker secret.
- `403`: a signed URL is invalid or expired; create a new URL instead of retrying it.
- `404`: verify the object key or source path.
- `413`: avoid JSON upload for large content; use multipart upload through the CLI.
- Network failure: report the Worker origin and status without printing credentials.
