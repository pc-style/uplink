import { Command } from "../command";
import { loadConfig } from "../config";
import { apiRequest, errorExit } from "../http";

export const uploadUrlCommand = new Command("upload-url")
  .description("Create a signed URL for a client to upload directly")
  .option("--filename, -n <name>", "Expected filename", "upload.bin")
  .option("--content-type, -t <type>", "Expected content type")
  .option("--ttl <seconds>", "Time-to-live for the upload URL", "900")
  .option("--json, -j", "Output result as JSON")
  .action(async (args, options) => {
    const config = await loadConfig();
    if (!config.server || !config.apiKey) {
      errorExit("Not configured. Run: uplink auth set --server <url> --key <api-key>");
    }

    const filename = String(options.filename || args[0] || "upload.bin");
    const ttl = String(options.ttl || "900");
    const contentType = String(options.contentType || "");

    const body: Record<string, unknown> = { filename, ttlSeconds: parseInt(ttl, 10) };
    if (contentType) body.contentType = contentType;

    const res = await apiRequest("POST", `${config.server}/api/upload-url`, config.apiKey, body);

    if (!res.ok) {
      const err = await res.text();
      errorExit(`Failed (${res.status}): ${err}`);
    }

    const data = await res.json() as { key: string; method: string; uploadUrl: string; expiresAt: string };

    if (options.json === true) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log(`\n  Upload URL: ${data.uploadUrl}`);
    console.log(`  Method:     ${data.method}`);
    console.log(`  Key:        ${data.key}`);
    console.log(`  Expires:    ${data.expiresAt}\n`);
  });
