import { Command } from "../command";
import { loadConfig } from "../config";
import { apiRequest, errorExit } from "../http";

export const infoCommand = new Command("info")
  .description("Get metadata for a stored file")
  .option("--key, -k <key>", "Object key (path) in storage")
  .option("--json, -j", "Output result as JSON")
  .action(async (args, options) => {
    const config = await loadConfig();
    if (!config.server || !config.apiKey) {
      errorExit("Not configured. Run: uplink auth set --server <url> --key <api-key>");
    }

    const key = String(options.key || args[0] || "");
    if (!key) {
      errorExit("Usage: uplink info --key <object-key>");
    }

    const res = await apiRequest("GET", `${config.server}/api/files/${encodeURIComponent(key)}`, config.apiKey);

    if (!res.ok) {
      const err = await res.text();
      errorExit(`Info failed (${res.status}): ${err}`);
    }

    const data = await res.json() as { key: string; size: number; etag: string; uploaded: string; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> };

    if (options.json === true) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log(`\n  Key:     ${data.key}`);
    console.log(`  Size:    ${formatBytes(data.size)}`);
    console.log(`  ETag:    ${data.etag}`);
    console.log(`  Uploaded: ${data.uploaded}`);
    if (data.httpMetadata) {
      console.log(`  Content-Type: ${data.httpMetadata.contentType || "(none)"}`);
    }
    if (data.customMetadata && Object.keys(data.customMetadata).length > 0) {
      console.log(`  Metadata:`);
      for (const [k, v] of Object.entries(data.customMetadata)) {
        console.log(`    ${k}: ${v}`);
      }
    }
    console.log();
  });

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
}
