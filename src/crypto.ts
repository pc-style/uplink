import { bytesToBase64Url } from "./base64url";

const textEncoder = new TextEncoder();

export async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
}

export async function safeEqualString(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  let diff = leftHash.length ^ rightHash.length;
  for (let index = 0; index < Math.max(leftHash.length, rightHash.length); index += 1) {
    diff |= (leftHash[index] ?? 0) ^ (rightHash[index] ?? 0);
  }
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload)));
  return [...signature].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Base64Url(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}
