import { homedir } from "os";
import { join } from "path";

export type Config = {
  server: string;
  apiKey: string;
};

const CONFIG_DIR = join(homedir(), ".config", "uplink");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export async function loadConfig(): Promise<Config> {
  try {
    const file = Bun.file(CONFIG_FILE);
    const data = await file.json();
    return {
      server: process.env.UPLINK_SERVER || data.server || "",
      apiKey: process.env.UPLINK_API_KEY || data.apiKey || "",
    };
  } catch {
    return { server: process.env.UPLINK_SERVER || "", apiKey: process.env.UPLINK_API_KEY || "" };
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function clearConfig(): Promise<void> {
  try {
    await Bun.$`rm -f ${CONFIG_FILE}`;
  } catch {}
}
