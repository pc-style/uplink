// Generates a self-describing API key: uplink_<host>_<secret>.
// The host segment lets clients derive the server URL from the key alone,
// so end users only configure a single UPLINK_API_KEY value.
const input = process.argv[2];

if (!input) {
  console.error("Usage: bun run make-key <deployment-url>");
  console.error("Example: bun run make-key https://uplink.example.workers.dev");
  process.exit(1);
}

let url: URL;
try {
  url = new URL(input.includes("://") ? input : `https://${input}`);
} catch {
  console.error(`Error: not a valid URL: ${input}`);
  process.exit(1);
}

if (url.protocol !== "https:") {
  console.error("Error: only https URLs can be embedded in a key");
  process.exit(1);
}
if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.username) {
  console.error("Error: use a bare origin (no path, query, or credentials)");
  process.exit(1);
}

const secret = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
const key = `uplink_${url.host}_${secret}`;

console.log(key);
console.error("");
console.error("Set it as the Worker's API key (paste the key above when prompted):");
console.error("  bunx wrangler secret put UPLINK_API_KEY");
console.error("");
console.error("Then give users the key; it is all they need:");
console.error(`  export UPLINK_API_KEY=${key.slice(0, 20)}...`);
