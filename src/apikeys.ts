import { hmacSha256Hex, safeEqualString } from "./crypto";

/**
 * Two kinds of API key are accepted:
 *
 * 1. The static `UPLINK_API_KEY` secret (label "default").
 * 2. Signed keys minted offline with `bun run new-key`:
 *    `uplink_<host>_<label>.<nonce>.<hmac>` where hmac = HMAC-SHA256(UPLINK_SIGNING_SECRET, "api-key\n<host>\n<label>\n<nonce>") as hex.
 *    They need no redeploy and are verified statelessly; rotating UPLINK_SIGNING_SECRET revokes all of them.
 *    The host is signed, not just cosmetic: verifyApiKey rejects a key whose embedded host doesn't match the
 *    request's host, so a key minted for one deployment can't authenticate to another that shares the same
 *    UPLINK_SIGNING_SECRET.
 *
 * The part after the last "_" never contains "_" so `uplink_<host>_<secret>` parsing in the CLI/skill keeps working.
 */

export const KEY_LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX_PATTERN = /^[0-9a-f]+$/;

export type ApiKeyIdentity = { label: string };

export function signedKeyMessage(host: string, label: string, nonce: string): string {
  return `api-key\n${host}\n${label}\n${nonce}`;
}

export async function mintSignedApiKey(signingSecret: string, host: string, label: string): Promise<string> {
  if (!KEY_LABEL_PATTERN.test(label)) throw new Error(`invalid label: ${label}`);
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sig = await hmacSha256Hex(signingSecret, signedKeyMessage(host, label, nonce));
  return `uplink_${host}_${label}.${nonce}.${sig}`;
}

/**
 * Returns the key's identity when `presented` is the static key or a valid signed key for `requestHost`,
 * otherwise null. A signed key whose embedded host doesn't match `requestHost` is rejected even if the
 * signature is valid for some other host under the same signing secret.
 */
export async function verifyApiKey(env: Env, presented: string | null, requestHost: string): Promise<ApiKeyIdentity | null> {
  if (!presented) return null;
  if (env.UPLINK_API_KEY && (await safeEqualString(presented, env.UPLINK_API_KEY))) {
    return { label: "default" };
  }
  if (!env.UPLINK_SIGNING_SECRET || !presented.startsWith("uplink_")) return null;
  const rest = presented.slice("uplink_".length);
  const lastUnderscore = rest.lastIndexOf("_");
  if (lastUnderscore === -1) return null;
  const host = rest.slice(0, lastUnderscore);
  const secretPart = rest.slice(lastUnderscore + 1);
  const [label, nonce, sig, extra] = secretPart.split(".");
  if (!host || !label || !nonce || !sig || extra !== undefined) return null;
  if (!KEY_LABEL_PATTERN.test(label) || !HEX_PATTERN.test(nonce) || !HEX_PATTERN.test(sig)) return null;
  if (host !== requestHost) return null;
  const expected = await hmacSha256Hex(env.UPLINK_SIGNING_SECRET, signedKeyMessage(host, label, nonce));
  return (await safeEqualString(sig, expected)) ? { label } : null;
}
