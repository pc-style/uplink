import { homedir } from "os";
import { join } from "path";

export type Config = {
  server: string;
  apiKey: string;
};

const CONFIG_DIR = join(homedir(), ".config", "uplink");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// Keys shaped uplink_<host>_<secret> embed the server, so the key alone is
// enough to configure the CLI. Hosts never contain "_", making the parse safe.
export function serverFromKey(apiKey: string): string {
  if (!apiKey.startsWith("uplink_")) return "";
  const rest = apiKey.slice("uplink_".length);
  const sep = rest.lastIndexOf("_");
  if (sep <= 0) return "";
  return `https://${rest.slice(0, sep)}`;
}

export async function loadConfig(): Promise<Config> {
  let stored: Partial<Config> = {};
  try {
    stored = await Bun.file(CONFIG_FILE).json();
  } catch {}
  const apiKey = process.env.UPLINK_API_KEY || stored.apiKey || "";
  return {
    server: process.env.UPLINK_SERVER || stored.server || serverFromKey(apiKey),
    apiKey,
  };
}

export async function saveConfig(config: Config): Promise<void> {
  await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function clearConfig(): Promise<void> {
  try {
    await Bun.$`rm -f ${CONFIG_FILE}`;
  } catch {}
}
