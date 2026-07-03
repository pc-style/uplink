import { DEFAULT_TTL_SECONDS, MAX_FILENAME_LENGTH, SHORT_LINK_TTL_SECONDS } from "./constants";
import { signedUrl, signToken } from "./signing";

export type UploadInput = {
  filename: string;
  contentType?: string;
  body: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob;
  metadata?: Record<string, string>;
  temporaryTtlSeconds?: number;
  permanent?: boolean;
  short?: boolean;
  shortName?: string;
};

export type UploadResult = {
  key: string;
  filename: string;
  size: number;
  contentType: string;
  uploadedAt: string;
  temporaryUrl?: string;
  permanentUrl?: string;
  shortUrl?: string;
  expiresAt?: string;
  shortExpiresAt?: string;
};

export function sanitizeFilename(filename: string): string {
  const fallback = "upload.bin";
  const cleaned = filename
    .split(/[\\/]/)
    .pop()
    ?.trim()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^a-zA-Z0-9._-]/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^-+|-+$/g, "");
  const safe = cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
  return safe.slice(0, MAX_FILENAME_LENGTH);
}

export function objectKey(filename: string, now = new Date()): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `uploads/${yyyy}/${mm}/${dd}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;
}

export function stringMetadata(metadata?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (/^[a-zA-Z0-9_.-]{1,64}$/.test(key) && value !== undefined && value !== null) {
      out[key] = typeof value === "string" ? value.slice(0, 512) : JSON.stringify(value).slice(0, 512);
    }
  }
  return out;
}

export function getDefaultTtl(env: Env): number {
  const value = Number(env.UPLINK_DEFAULT_TTL_SECONDS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TTL_SECONDS;
}

const SHORT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function isValidShortName(name: string): boolean {
  return SHORT_NAME_REGEX.test(name);
}

function shortId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

export async function createShortUrl(
  env: Env,
  request: Request,
  token: string,
  expiresAt?: string,
  customName?: string,
): Promise<string> {
  let id: string;
  let isCustom = false;

  if (customName) {
    if (!isValidShortName(customName)) {
      throw new Error("INVALID_SHORT_NAME");
    }
    isCustom = true;
    id = customName;
    const existing = await env.UPLINK_BUCKET.head(`short/${id}`);
    if (existing) {
      throw new Error("SHORT_NAME_TAKEN");
    }
  } else {
    for (let i = 0; i < 5; i++) {
      id = shortId();
      const existing = await env.UPLINK_BUCKET.head(`short/${id}`);
      if (existing) continue;

      await env.UPLINK_BUCKET.put(`short/${id}`, JSON.stringify({ token, expiresAt }), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: expiresAt ? { expiresAt } : undefined,
      });
      return `${new URL(request.url).origin}/s/${id}`;
    }
    throw new Error("Could not create short URL.");
  }

  // Custom name path (no collision)
  await env.UPLINK_BUCKET.put(`short/${id}`, JSON.stringify({ token, expiresAt }), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: expiresAt ? { expiresAt } : undefined,
  });
  return `${new URL(request.url).origin}/s/${id}`;
}

export async function storeUpload(env: Env, request: Request, input: UploadInput): Promise<UploadResult> {
  const uploadedAt = new Date().toISOString();
  const filename = sanitizeFilename(input.filename);
  const contentType = input.contentType || "application/octet-stream";
  const key = objectKey(filename);
  const customMetadata = {
    filename,
    uploadedAt,
    ...input.metadata,
  };

  const object = await env.UPLINK_BUCKET.put(key, input.body, {
    httpMetadata: {
      contentType,
      contentDisposition: `attachment; filename="${filename.replaceAll('"', '\\"')}"`,
    },
    customMetadata,
  });
  if (!object) throw new Error("R2 put failed.");

  const temporaryTtl = input.temporaryTtlSeconds ?? getDefaultTtl(env);
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + temporaryTtl;
  const temporaryToken = await signToken(env, { purpose: "download", key, expiresAt: expiresAtSeconds });
  const result: UploadResult = {
    key,
    filename,
    size: object.size,
    contentType,
    uploadedAt,
    temporaryUrl: signedUrl(request, "/d", temporaryToken),
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  };

  if (input.permanent) {
    const permanentToken = await signToken(env, { purpose: "download", key });
    result.permanentUrl = signedUrl(request, "/d", permanentToken);
  }

  if (input.short || input.shortName) {
    const usePermanent = input.permanent === true;
    const customName = input.shortName;

    let shortToken: string;
    let shortExpiresAt: string | undefined;

    if (usePermanent) {
      shortToken = await signToken(env, { purpose: "download", key });
    } else {
      const shortExpiresAtSeconds = Math.floor(Date.now() / 1000) + SHORT_LINK_TTL_SECONDS;
      shortToken = await signToken(env, { purpose: "download", key, expiresAt: shortExpiresAtSeconds });
      shortExpiresAt = new Date(shortExpiresAtSeconds * 1000).toISOString();
    }

    try {
      result.shortUrl = await createShortUrl(env, request, shortToken, shortExpiresAt, customName);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "SHORT_NAME_TAKEN") throw new Error("SHORT_NAME_TAKEN");
        if (err.message === "INVALID_SHORT_NAME") throw new Error("INVALID_SHORT_NAME");
      }
      throw err;
    }

    if (shortExpiresAt) {
      result.shortExpiresAt = shortExpiresAt;
    }
  }

  return result;
}

export function objectInfo(object: R2Object): Record<string, unknown> {
  return {
    key: object.key,
    size: object.size,
    etag: object.etag,
    uploaded: object.uploaded.toISOString(),
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  };
}
