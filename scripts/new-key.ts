// Mints an additional, named API key without redeploying:
//   uplink_<host>_<label>.<nonce>.<hmac>
// The Worker verifies it with UPLINK_SIGNING_SECRET, so the same secret the
// deployment uses must be available here (env var, .env, or .dev.vars).
import { KEY_LABEL_PATTERN, mintSignedApiKey } from "../src/apikeys";

const [input, label = "agent"] = process.argv.slice(2);

if (!input) {
  console.error("Usage: bun run new-key <deployment-url> [label]");
  console.error("Example: bun run new-key https://uplink.example.workers.dev ci-bot");
  console.error("");
  console.error("Needs UPLINK_SIGNING_SECRET (the deployment's secret) in the environment, .env, or .dev.vars.");
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
if (!KEY_LABEL_PATTERN.test(label)) {
  console.error("Error: label must be 1-64 chars of a-z, 0-9, or '-' and start with a letter or digit");
  process.exit(1);
}

let secret = process.env.UPLINK_SIGNING_SECRET;
if (!secret) {
  const devVars = Bun.file(new URL("../.dev.vars", import.meta.url));
  if (await devVars.exists()) {
    const match = (await devVars.text()).match(/^UPLINK_SIGNING_SECRET\s*=\s*"?([^"\n]+)"?/m);
    secret = match?.[1]?.trim();
  }
}
if (!secret) {
  console.error("Error: UPLINK_SIGNING_SECRET is not set.");
  console.error("Export the deployment's signing secret, or put it in .env or .dev.vars, then rerun.");
  process.exit(1);
}

const key = await mintSignedApiKey(secret, url.host, label);
console.log(key);
console.error("");
console.error(`Label "${label}". Works immediately, no redeploy. Rotating UPLINK_SIGNING_SECRET revokes every key made this way.`);
console.error(`  export UPLINK_API_KEY=${key.slice(0, 24)}...`);
