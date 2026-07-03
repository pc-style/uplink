import { Command } from "../command";
import { loadConfig } from "../config";
import { errorExit } from "../http";

export const downloadCommand = new Command("download")
  .description("Download a file from a signed URL or by key")
  .option("--url, -u <url>", "Full signed download URL")
  .option("--key, -k <key>", "Object key (will create a signed URL first)")
  .option("--output, -o <path>", "Output file path (defaults to filename or stdout)")
  .action(async (args, options) => {
    const config = await loadConfig();
    if (!config.server || !config.apiKey) {
      errorExit("Not configured. Run: uplink auth set --server <url> --key <api-key>");
    }

    let downloadUrl = String(options.url || "");

    if (!downloadUrl) {
      const key = String(options.key || args[0] || "");
      if (!key) {
        errorExit("Usage: uplink download --url <signed-url> OR uplink download --key <object-key>");
      }

      const { apiRequest } = await import("../http");
      const res = await apiRequest("POST", `${config.server}/api/sign`, config.apiKey, { key, permanent: true });
      if (!res.ok) {
        const err = await res.text();
        errorExit(`Failed to sign (${res.status}): ${err}`);
      }
      const data = await res.json() as { url: string };
      downloadUrl = data.url;
    }

    const res = await fetch(downloadUrl);
    if (!res.ok) {
      errorExit(`Download failed (${res.status})`);
    }

    const outputPath = String(options.output || "");
    if (outputPath) {
      const writer = Bun.file(outputPath).writer();
      const reader = res.body?.getReader();
      if (!reader) {
        errorExit("No response body");
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          writer.write(value);
        }
      } finally {
        await writer.end();
      }
      console.log(`Downloaded to: ${outputPath}`);
    } else {
      const blob = await res.blob();
      const arrayBuffer = await blob.arrayBuffer();
      await Bun.write(Bun.stdout, new Uint8Array(arrayBuffer));
    }
  });
