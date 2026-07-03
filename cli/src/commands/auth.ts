import { Command } from "../command";
import { loadConfig, saveConfig, clearConfig } from "../config";

export const authCommand = new Command("auth")
  .description("Manage authentication (server URL and API key)")
  .action(async (args, options) => {
    const sub = args[0];
    if (sub === "set") {
      const server = String(options.server || "");
      const apiKey = String(options.key || "");
      if (!server || !apiKey) {
        console.error("Error: --server and --key are required");
        process.exit(1);
      }
      await saveConfig({ server: server.replace(/\/+$/, ""), apiKey });
      console.log("Credentials saved.");
    } else if (sub === "show") {
      const config = await loadConfig();
      if (!config.server && !config.apiKey) {
        console.log("No credentials configured. Run: uplink auth set --server <url> --key <api-key>");
        return;
      }
      console.log(`Server:  ${config.server || "(not set)"}`);
      console.log(`API Key: ${config.apiKey ? "********" + config.apiKey.slice(-4) : "(not set)"}`);
    } else if (sub === "clear") {
      await clearConfig();
      console.log("Credentials cleared.");
    } else {
      console.log("Usage: uplink auth <set|show|clear>");
      console.log("  set   --server <url> --key <api-key>   Save credentials");
      console.log("  show                                   Show current credentials");
      console.log("  clear                                  Remove saved credentials");
      process.exit(1);
    }
  });
