---
name: uploading-with-uplink
description: Uploads and shares files through a self-hosted up!link REST API. Use when asked to upload a local file, ingest a URL, or create a temporary, permanent, short, or custom link with up!link.
compatibility: Requires curl, UPLINK_BASE_URL, and UPLINK_API_KEY.
---

# Uploading with up!link

Use `curl` only. Never print or commit `UPLINK_API_KEY`. If either environment variable is missing, ask the user to configure it rather than guessing.

Upload a local file, defaulting to a temporary link:

```sh
curl -sS --fail-with-body \
  "${UPLINK_BASE_URL%/}/api/upload" \
  -H "Authorization: Bearer $UPLINK_API_KEY" \
  -F "file=@<path>" \
  -F "permanent=false"
```

Use `permanent=true` only when requested. Add `short=true` for a seven-day short link, plus `shortName=<name>` for a custom path. Return the relevant `temporaryUrl`, `permanentUrl`, or `shortUrl`, not the full response.

For a file already online, call `POST ${UPLINK_BASE_URL%/}/api/ingest-url` with JSON containing `url`, `filename`, and `permanent`. For direct client uploads, call `POST /api/upload-url`, then `PUT` the bytes to its returned `uploadUrl` without the API key.

Treat `401` as bad configuration, `403` as an expired or invalid signed URL, `409` as a duplicate custom path, and `413` as a reason to use multipart instead of JSON.
