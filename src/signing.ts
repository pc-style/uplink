import { base64UrlToText, textToBase64Url } from "./base64url";
import { hmacSha256Base64Url, safeEqualString } from "./crypto";

export type SignedPurpose = "download" | "upload";

export type SignedPayload = {
  purpose: SignedPurpose;
  key: string;
  exp?: number;
  filename?: string;
  contentType?: string;
};

export type SignOptions = {
  purpose: SignedPurpose;
  key: string;
  expiresAt?: number;
  filename?: string;
  contentType?: string;
};

export async function signToken(env: Env, options: SignOptions): Promise<string> {
  const payload: SignedPayload = {
    purpose: options.purpose,
    key: options.key,
    exp: options.expiresAt,
    filename: options.filename,
    contentType: options.contentType,
  };
  const payloadPart = textToBase64Url(JSON.stringify(payload));
  const signaturePart = await hmacSha256Base64Url(env.UPLINK_SIGNING_SECRET, payloadPart);
  return `${payloadPart}.${signaturePart}`;
}

export async function verifyToken(
  env: Env,
  token: string,
  purpose: SignedPurpose,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SignedPayload | null> {
  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra !== undefined) return null;
  const expectedSignature = await hmacSha256Base64Url(env.UPLINK_SIGNING_SECRET, payloadPart);
  if (!(await safeEqualString(signaturePart, expectedSignature))) return null;

  let payload: SignedPayload;
  try {
    payload = JSON.parse(base64UrlToText(payloadPart)) as SignedPayload;
  } catch {
    return null;
  }

  if (payload.purpose !== purpose || typeof payload.key !== "string" || payload.key.length === 0) {
    return null;
  }
  if (payload.exp !== undefined && (!Number.isInteger(payload.exp) || payload.exp < nowSeconds)) {
    return null;
  }
  return payload;
}

export function signedUrl(request: Request, path: string, token: string): string {
  const url = new URL(request.url);
  url.pathname = path.endsWith("/") ? `${path}${token}` : `${path}/${token}`;
  url.search = "";
  return url.toString();
}
