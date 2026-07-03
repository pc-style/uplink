import { Command } from "../command";
import { loadConfig } from "../config";
import { apiRequest, errorExit } from "../http";

export const signCommand = new Command("sign")
  .description("Create a signed download URL for an existing file")
  .option("--key, -k <key>", "Object key (path) in storage")
  .option("--ttl <seconds>", "Time-to-live for the signed URL", "3600")
  .option("--permanent, -p", "Create a permanent (non-expiring) URL")
  .option("--short, -s", "Also create a short share URL (7 days by default, permanent if -p)")
  .option("--custom-url <name>", "Use a custom short URL name (implies --short)")
  .option("--copy, -c", "Copy the resulting URL (or short URL) to the clipboard")
  .option("--json, -j", "Output result as JSON")
  .action(async (args, options) => {
    const config = await loadConfig();
    if (!config.server || !config.apiKey) {
      errorExit("Not configured. Run: uplink auth set --server <url> --key <api-key>");
    }

    const key = String(options.key || args[0] || "");
    if (!key) {
      errorExit("Usage: uplink sign --key <object-key> [options]");
    }

    const ttl = String(options.ttl || "3600");
    const permanent = options.permanent === true;
    const short = options.short === true;
    const customUrl = options.customUrl ? String(options.customUrl) : undefined;
    const copy = options.copy === true;

    const body: Record<string, unknown> = { key };
    if (permanent) {
      body.permanent = true;
    } else {
      body.ttlSeconds = parseInt(ttl, 10);
    }
    if (short || customUrl) {
      body.short = true;
      if (customUrl) body.shortName = customUrl;
    }

    const res = await apiRequest("POST", `${config.server}/api/sign`, config.apiKey, body);

    if (!res.ok) {
      const err = await res.text();
      errorExit(`Sign failed (${res.status}): ${err}`);
    }

    const data = await res.json() as {
      key: string; url: string; permanent: boolean; expiresAt?: string;
      shortUrl?: string; shortExpiresAt?: string;
    };

    // Determine link to copy
    const linkToCopy = (customUrl || short) && data.shortUrl ? data.shortUrl : data.url;

    if (copy && linkToCopy) {
      try {
        await Bun.$`echo -n ${linkToCopy} | pbcopy`.quiet();
      } catch {}
    }

    if (options.json === true) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log(`\n  Key:       ${data.key}`);
    console.log(`  URL:       ${data.url}`);
    if (data.shortUrl) {
      console.log(`  Short:     ${data.shortUrl}`);
    }
    console.log(`  Permanent: ${data.permanent}`);
    if (data.expiresAt) {
      console.log(`  Expires:   ${data.expiresAt}`);
    }
    if (data.shortExpiresAt) {
      console.log(`  Short expires: ${data.shortExpiresAt}`);
    }
    console.log();

    if (copy && linkToCopy) {
      console.log(`Copied to clipboard: ${linkToCopy}`);
    }
  });
