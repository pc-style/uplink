import { JSON_CONTENT_TYPES, MAX_JSON_BYTES } from "./constants";
import { errorJson } from "./http";
import { stringMetadata, storeUpload, type UploadResult } from "./storage";

const textEncoder = new TextEncoder();

type JsonUpload = {
  filename?: unknown;
  encoding?: unknown;
  content?: unknown;
  contentType?: unknown;
  metadata?: unknown;
  ttlSeconds?: unknown;
  permanent?: unknown;
  short?: unknown;
  shortName?: unknown;
  url?: unknown;
  key?: unknown;
};

export class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }

  response(): Response {
    return errorJson(this.status, this.code, this.message);
  }
}

export function requestContentType(request: Request): string {
  return request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function parsePositiveInteger(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function readLimitedJson(request: Request, env: Env): Promise<JsonUpload> {
  const limit = parsePositiveInteger(env.UPLINK_MAX_JSON_BYTES, MAX_JSON_BYTES) ?? MAX_JSON_BYTES;
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > limit) {
    throw new UploadError(413, "json_too_large", `JSON uploads are limited to ${limit} bytes.`);
  }
  const text = await request.text();
  if (textEncoder.encode(text).byteLength > limit) {
    throw new UploadError(413, "json_too_large", `JSON uploads are limited to ${limit} bytes.`);
  }
  try {
    return JSON.parse(text) as JsonUpload;
  } catch {
    throw new UploadError(400, "invalid_json", "Request body is not valid JSON.");
  }
}

export async function handleJsonUpload(env: Env, request: Request): Promise<UploadResult> {
  const payload = await readLimitedJson(request, env);
  if (typeof payload.filename !== "string" || payload.filename.trim() === "") {
    throw new UploadError(400, "filename_required", "JSON upload requires a filename.");
  }
  if (typeof payload.content !== "string") {
    throw new UploadError(400, "content_required", "JSON upload requires string content.");
  }

  const encoding = typeof payload.encoding === "string" ? payload.encoding.toLowerCase() : "text";
  let body: Uint8Array | string;
  if (encoding === "base64") {
    try {
      body = decodeBase64(payload.content);
    } catch {
      throw new UploadError(400, "invalid_base64", "Content is not valid base64.");
    }
  } else if (encoding === "text" || encoding === "utf-8" || encoding === "utf8") {
    body = payload.content;
  } else {
    throw new UploadError(400, "unsupported_encoding", "encoding must be text, utf-8, or base64.");
  }

  return storeUpload(env, request, {
    filename: payload.filename,
    contentType: typeof payload.contentType === "string" ? payload.contentType : undefined,
    body,
    metadata: stringMetadata(payload.metadata && typeof payload.metadata === "object" ? (payload.metadata as Record<string, unknown>) : undefined),
    temporaryTtlSeconds: parsePositiveInteger(payload.ttlSeconds),
    permanent: payload.permanent === true,
    short: payload.short === true,
    shortName: typeof payload.shortName === "string" ? payload.shortName : undefined,
  });
}

export async function handleMultipartUpload(env: Env, request: Request): Promise<UploadResult> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new UploadError(400, "file_required", "multipart/form-data upload requires a file field.");
  }
  const metadataValue = form.get("metadata");
  let metadata: Record<string, string> | undefined;
  if (typeof metadataValue === "string" && metadataValue.trim()) {
    try {
      metadata = stringMetadata(JSON.parse(metadataValue));
    } catch {
      throw new UploadError(400, "invalid_metadata", "metadata must be valid JSON.");
    }
  }

  const receivedShort = form.get("short") === "true";
  const receivedShortName = typeof form.get("shortName") === "string" ? String(form.get("shortName")) : undefined;

  return storeUpload(env, request, {
    filename: typeof form.get("filename") === "string" ? String(form.get("filename")) : file.name,
    contentType: file.type || "application/octet-stream",
    body: file,
    metadata,
    temporaryTtlSeconds: parsePositiveInteger(form.get("ttlSeconds")),
    permanent: form.get("permanent") === "true",
    short: receivedShort,
    shortName: receivedShortName,
  });
}

export async function handleRawUpload(env: Env, request: Request): Promise<UploadResult> {
  if (!request.body) {
    throw new UploadError(400, "body_required", "Raw upload requires a request body.");
  }
  const filename = request.headers.get("x-filename") ?? new URL(request.url).searchParams.get("filename");
  if (!filename) {
    throw new UploadError(400, "filename_required", "Raw upload requires x-filename header or filename query parameter.");
  }
  const search = new URL(request.url).searchParams;
  return storeUpload(env, request, {
    filename,
    contentType: request.headers.get("content-type") ?? "application/octet-stream",
    body: request.body,
    metadata: stringMetadata({ source: "raw" }),
    temporaryTtlSeconds: parsePositiveInteger(search.get("ttlSeconds")),
    permanent: search.get("permanent") === "true",
    short: search.get("short") === "true",
    shortName: search.get("shortName") || undefined,
  });
}

export async function handleUpload(env: Env, request: Request): Promise<UploadResult> {
  const contentType = requestContentType(request);
  if (JSON_CONTENT_TYPES.includes(contentType)) return handleJsonUpload(env, request);
  if (contentType === "multipart/form-data") return handleMultipartUpload(env, request);
  return handleRawUpload(env, request);
}
