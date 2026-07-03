import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { Command } from "../command";
import { loadConfig } from "../config";
import { apiRequest, errorExit } from "../http";

type ManifestFile = {
  path: string;
  key: string;
  size: number;
  contentType: string;
  uploadedAt: string;
};

type Manifest = {
  version: 1;
  createdAt: string;
  sourceDir: string;
  files: ManifestFile[];
};

const MEDIA_RE = /\.(jpe?g|png|webp|gif|mp4|mov|wav|mp3|m4a|aac)$/i;

export const syncCommand = new Command("sync")
  .description("Push or pull a directory through up!link using a local manifest")
  .usage("uplink sync <push|pull> [--dir assets] [--manifest uplink-manifest.json] [--json]")
  .option("--dir, -d <path>", "Directory to sync", "assets")
  .option("--manifest, -m <path>", "Manifest file path", "uplink-manifest.json")
  .option("--all", "Include every regular file, not just common media extensions")
  .option("--json, -j", "Output result as JSON")
  .action(async (args, options) => {
    const sub = args[0];
    if (sub === "push") {
      await pushDirectory(options);
      return;
    }
    if (sub === "pull") {
      await pullDirectory(options);
      return;
    }
    errorExit("Usage: uplink sync <push|pull> [--dir assets] [--manifest uplink-manifest.json]");
  });

async function pushDirectory(options: Record<string, string | boolean>): Promise<void> {
  const config = await configured();
  const dir = String(options.dir || "assets");
  const manifestPath = String(options.manifest || "uplink-manifest.json");
  const includeAll = options.all === true;
  const files = await collectFiles(dir, includeAll);

  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceDir: dir,
    files: [],
  };

  for (const path of files) {
    const rel = relative(dir, path).replaceAll("\\", "/");
    const file = Bun.file(path);
    const form = new FormData();
    form.append("file", file, rel);
    form.append("filename", rel);
    form.append("permanent", "true");

    const res = await apiRequest("POST", `${config.server}/api/upload`, config.apiKey, form);
    if (!res.ok) {
      const body = await res.text();
      errorExit(`Upload failed for ${rel} (${res.status}): ${body}`);
    }
    const data = await res.json() as { key: string; size: number; contentType: string; uploadedAt: string };
    manifest.files.push({ path: rel, key: data.key, size: data.size, contentType: data.contentType, uploadedAt: data.uploadedAt });
    if (options.json !== true) console.log(`uploaded ${rel} -> ${data.key}`);
  }

  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  if (options.json === true) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  console.log(`Wrote manifest: ${manifestPath}`);
}

async function pullDirectory(options: Record<string, string | boolean>): Promise<void> {
  const config = await configured();
  const dir = String(options.dir || "assets");
  const manifestPath = String(options.manifest || "uplink-manifest.json");
  const manifest = await Bun.file(manifestPath).json() as Manifest;

  for (const file of manifest.files) {
    const out = join(dir, file.path);
    await mkdir(dirname(out), { recursive: true });

    const sign = await apiRequest("POST", `${config.server}/api/sign`, config.apiKey, { key: file.key, permanent: true });
    if (!sign.ok) {
      const body = await sign.text();
      errorExit(`Sign failed for ${file.path} (${sign.status}): ${body}`);
    }
    const signed = await sign.json() as { url: string };
    const res = await fetch(signed.url);
    if (!res.ok) errorExit(`Download failed for ${file.path} (${res.status})`);
    await Bun.write(out, await res.arrayBuffer());
    if (options.json !== true) console.log(`downloaded ${file.path}`);
  }

  if (options.json === true) {
    console.log(JSON.stringify({ downloaded: manifest.files.length, dir, manifest: manifestPath }, null, 2));
    return;
  }
  console.log(`Downloaded ${manifest.files.length} file(s) to ${dir}`);
}

async function configured(): Promise<{ server: string; apiKey: string }> {
  const config = await loadConfig();
  if (!config.server || !config.apiKey) {
    errorExit("Not configured. Run: uplink auth set --server <url> --key <api-key>");
  }
  return config;
}

async function collectFiles(dir: string, includeAll: boolean): Promise<string[]> {
  const found: string[] = [];
  async function walk(path: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && (includeAll || MEDIA_RE.test(full))) {
        found.push(full);
      }
    }
  }
  await walk(dir);
  found.sort((a, b) => a.localeCompare(b));
  return found;
}
