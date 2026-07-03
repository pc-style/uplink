import { Command } from "../command";
import { loadConfig } from "../config";
import { apiRequest, errorExit } from "../http";

export const ingestCommand = new Command("ingest")
  .description("Download a file from a remote URL and store it in up!link")
  .option("--url, -u <url>", "Source URL to fetch")
  .option("--filename, -n <name>", "Override the stored filename")
  .option("--content-type, -t <type>", "Override content type")
  .option("--ttl <seconds>", "Time-to-live for the temporary download URL", "3600")
  .option("--permanent, -p", "Also generate a permanent download URL")
  .option("--short, -s", "Create a really short share URL (auto-expires in 7 days)")
  .option("--custom-url <name>", "Use a custom short URL name (implies --short)")
  .option("--copy, -c", "Copy the resulting URL to the clipboard")
  .option("--json, -j", "Output result as JSON")
  .action(async (args, options) => {
    const config = await loadConfig();
    if (!config.server || !config.apiKey) {
      errorExit("Not configured. Run: uplink auth set --server <url> --key <api-key>");
    }

    const sourceUrl = String(options.url || args[0] || "");
    if (!sourceUrl) {
      errorExit("Usage: uplink ingest --url <source-url> [options]");
    }

    const ttl = String(options.ttl || "3600");
    const permanent = options.permanent === true;
    const short = options.short === true;
    const customUrl = options.customUrl ? String(options.customUrl) : undefined;
    const copy = options.copy === true;

    const body: Record<string, unknown> = { url: sourceUrl, ttlSeconds: parseInt(ttl, 10) };
    if (options.filename) body.filename = String(options.filename);
    if (options.contentType) body.contentType = String(options.contentType);
    if (permanent) body.permanent = true;
    if (short) body.short = true;
    if (customUrl) body.shortName = customUrl;

    const res = await apiRequest("POST", `${config.server}/api/ingest-url`, config.apiKey, body);

    if (!res.ok) {
      const err = await res.text();
      errorExit(`Ingest failed (${res.status}): ${err}`);
    }

    const data = await res.json() as {
      key: string; filename: string; size: number; contentType: string; uploadedAt: string;
      temporaryUrl?: string; permanentUrl?: string; shortUrl?: string; expiresAt?: string;
    };

    const linkToCopy = (customUrl || short) && data.shortUrl
      ? data.shortUrl
      : permanent && data.permanentUrl ? data.permanentUrl : data.temporaryUrl;

    if (copy && linkToCopy) {
      try { await Bun.$`echo -n ${linkToCopy} | pbcopy`.quiet(); } catch {}
    }

    if (options.json === true) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    if ((short || customUrl) && data.shortUrl) {
      console.log(data.shortUrl);
      if (copy) console.error("Copied to clipboard.");
      return;
    }

    console.log(`\n  Ingested:  ${data.filename}`);
    console.log(`  Key:       ${data.key}`);
    console.log(`  Size:      ${formatBytes(data.size)}`);
    console.log(`  Type:      ${data.contentType}`);
    console.log(`  URL:       ${data.temporaryUrl}`);
    if (data.shortUrl) {
      console.log(`  Short:     ${data.shortUrl}`);
    }
    if (data.permanentUrl) {
      console.log(`  Permanent: ${data.permanentUrl}`);
    }
    console.log(`  Expires:   ${data.expiresAt}\n`);

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
