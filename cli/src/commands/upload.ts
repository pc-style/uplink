import { Command } from "../command";
import { loadConfig } from "../config";
import { apiRequest, errorExit } from "../http";

export const uploadCommand = new Command("upload")
  .description("Upload a file to up!link")
  .usage("uplink upload <file> [-s] [-p] [--custom-url <name>] [-c] [--json]")
  .option("--file, -f <path>", "Path to the file to upload")
  .option("--filename, -n <name>", "Override the filename stored on the server")
  .option("--content-type, -t <type>", "Content type (auto-detected if not set)")
  .option("--ttl <seconds>", "Time-to-live for the temporary download URL", "3600")
  .option("--permanent, -p", "Also generate a permanent download URL")
  .option("--short, -s", "Create a really short share URL (auto-expires in 7 days)")
  .option("--custom-url <name>", "Use a custom short URL name instead of a random one (e.g. --custom-url myreport)")
  .option("--copy, -c", "Copy the resulting URL to the clipboard (short URL if -s/--custom-url, permanent if -p, else temporary)")
  .option("--json, -j", "Output result as JSON")
  .action(async (args, options) => {
    const config = await loadConfig();
    if (!config.server || !config.apiKey) {
      errorExit("Not configured. Run: uplink auth set --server <url> --key <api-key>");
    }

    const filePath = String(options.file || args[0] || "");
    if (!filePath) {
      errorExit("Usage: uplink upload <file> [--short]\n       uplink upload --file <path> [options]");
    }

    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
      errorExit(`File not found: ${filePath}`);
    }

    const filename = String(options.filename || args[1] || filePath.split(/[\\/]/).pop() || "upload.bin");
    const contentType = String(options.contentType || file.type || "application/octet-stream");
    const ttl = String(options.ttl || "3600");
    const permanent = options.permanent === true;
    const short = options.short === true;
    const customUrl = options.customUrl ? String(options.customUrl) : undefined;
    const copy = options.copy === true;

    const form = new FormData();
    form.append("file", file, filename);
    form.append("filename", filename);
    form.append("ttlSeconds", ttl);
    if (permanent) form.append("permanent", "true");
    if (short || customUrl) form.append("short", "true");
    if (customUrl) form.append("shortName", customUrl);

    const url = `${config.server}/api/upload`;
    const res = await apiRequest("POST", url, config.apiKey, form);

    if (!res.ok) {
      const body = await res.text();
      errorExit(`Upload failed (${res.status}): ${body}`);
    }

    const data = await res.json() as {
      key: string; filename: string; size: number; contentType: string; uploadedAt: string;
      temporaryUrl?: string; permanentUrl?: string; shortUrl?: string; expiresAt?: string; shortExpiresAt?: string;
    };

    // Determine which link to copy (priority: custom/short > permanent > temporary)
    const linkToCopy = (customUrl || short) && data.shortUrl
      ? data.shortUrl
      : permanent && data.permanentUrl
        ? data.permanentUrl
        : data.temporaryUrl;

    if (copy && linkToCopy) {
      try {
        // macOS clipboard (Bun native)
        await Bun.$`echo -n ${linkToCopy} | pbcopy`.quiet();
      } catch {
        // Non-fatal on other platforms or if pbcopy missing
      }
    }

    if (options.json === true) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    // -s or --custom-url: print ONLY the short link (full URL, ready to share)
    if ((short || customUrl) && data.shortUrl) {
      console.log(data.shortUrl);
      if (copy) {
        console.error(`Copied to clipboard.`);
      }
      return;
    }

    console.log(`\n  Uploaded: ${data.filename}`);
    console.log(`  Key:      ${data.key}`);
    console.log(`  Size:     ${formatBytes(data.size)}`);
    console.log(`  Type:     ${data.contentType}`);
    console.log(`  URL:      ${data.temporaryUrl}`);
    if (data.shortUrl) {
      console.log(`  Short:    ${data.shortUrl}`);
    }
    if (data.permanentUrl) {
      console.log(`  Permanent: ${data.permanentUrl}`);
    }
    console.log(`  Expires:  ${data.expiresAt}\n`);

    if (copy && linkToCopy) {
      console.log(`Copied to clipboard: ${linkToCopy}`);
    }
  });

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
}
