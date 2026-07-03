import { isAuthorized } from "./auth";
import { errorJson, json, methodNotAllowed, notFound } from "./http";
import { signToken, signedUrl, verifyToken } from "./signing";
import { createShortUrl, getDefaultTtl, objectInfo, sanitizeFilename, stringMetadata, storeUpload } from "./storage";
import { handleUpload, parsePositiveInteger, readLimitedJson, UploadError } from "./uploads";

async function requireAuth(request: Request, env: Env): Promise<Response | null> {
  return (await isAuthorized(request, env)) ? null : errorJson(401, "unauthorized", "Missing or invalid API key.");
}

export async function handleRest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/") {
      return json({
        name: "up!link",
        status: "ok",
        endpoints: ["/api/upload", "/api/upload-url", "/api/ingest-url", "/api/sign", "/api/files/:key", "/mcp"],
      });
    }

    if (url.pathname.startsWith("/d/")) {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return handleDownload(request, env, decodeURIComponent(url.pathname.slice("/d/".length)));
    }

    if (url.pathname.startsWith("/u/")) {
      if (request.method !== "PUT") return methodNotAllowed(["PUT"]);
      return handleSignedPut(request, env, decodeURIComponent(url.pathname.slice("/u/".length)));
    }

    if (url.pathname.startsWith("/s/")) {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return handleShortLink(request, env, decodeURIComponent(url.pathname.slice("/s/".length)));
    }

    if (url.pathname === "/api/upload") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      const auth = await requireAuth(request, env);
      if (auth) return auth;
      return json(await handleUpload(env, request), { status: 201 });
    }

    if (url.pathname === "/api/upload-url") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      const auth = await requireAuth(request, env);
      if (auth) return auth;
      return json(await handleUploadUrl(request, env), { status: 201 });
    }

    if (url.pathname === "/api/ingest-url") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      const auth = await requireAuth(request, env);
      if (auth) return auth;
      return json(await handleIngestUrl(request, env), { status: 201 });
    }

    if (url.pathname === "/api/sign") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      const auth = await requireAuth(request, env);
      if (auth) return auth;
      return json(await handleSign(request, env));
    }

    if (url.pathname.startsWith("/api/files/")) {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      const auth = await requireAuth(request, env);
      if (auth) return auth;
      return handleInfo(env, decodeURIComponent(url.pathname.slice("/api/files/".length)));
    }

    return notFound();
  } catch (error) {
    if (error instanceof UploadError) return error.response();
    if (error instanceof Error) {
      if (error.message === "SHORT_NAME_TAKEN") {
        return errorJson(409, "short_name_taken", "That custom short URL name is already in use.");
      }
      if (error.message === "INVALID_SHORT_NAME") {
        return errorJson(400, "invalid_short_name", "Custom short name must start with a letter or number and contain only letters, numbers, -, or _ (1-64 chars).");
      }
    }
    console.error(JSON.stringify({ level: "error", message: error instanceof Error ? error.message : String(error) }));
    return errorJson(500, "internal_error", "Unexpected error.");
  }
}

async function handleDownload(request: Request, env: Env, token: string): Promise<Response> {
  const payload = await verifyToken(env, token, "download");
  if (!payload) return errorJson(403, "invalid_token", "Download token is invalid or expired.");

  const object = await env.UPLINK_BUCKET.get(payload.key);
  if (!object || !("body" in object)) return errorJson(404, "not_found", "Object not found.");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  headers.set("cache-control", payload.exp ? "private, max-age=60" : "private, max-age=300");
  return new Response(object.body, { headers });
}

async function handleShortLink(request: Request, env: Env, id: string): Promise<Response> {
  // Support both auto-generated (alnum) and custom short names (alnum + _ - , starting with alnum, up to 64 chars)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) return notFound();
  const object = await env.UPLINK_BUCKET.get(`short/${id}`);
  if (!object) return notFound();

  const link = await object.json<{ token?: string; expiresAt?: string }>();
  if (!link.token) return notFound();
  if (link.expiresAt && Date.parse(link.expiresAt) <= Date.now()) {
    return errorJson(410, "expired", "Short link expired.");
  }

  return Response.redirect(signedUrl(request, "/d", link.token), 302);
}

async function handleSignedPut(request: Request, env: Env, token: string): Promise<Response> {
  const payload = await verifyToken(env, token, "upload");
  if (!payload) return errorJson(403, "invalid_token", "Upload token is invalid or expired.");
  if (!request.body) return errorJson(400, "body_required", "Signed PUT requires a request body.");

  const filename = sanitizeFilename(payload.filename ?? payload.key.split("/").pop() ?? "upload.bin");
  const contentType = request.headers.get("content-type") ?? payload.contentType ?? "application/octet-stream";
  const uploadedAt = new Date().toISOString();
  const object = await env.UPLINK_BUCKET.put(payload.key, request.body, {
    httpMetadata: {
      contentType,
      contentDisposition: `attachment; filename="${filename.replaceAll('"', '\\"')}"`,
    },
    customMetadata: { filename, uploadedAt, source: "signed-put" },
  });
  if (!object) return errorJson(500, "r2_put_failed", "R2 put failed.");

  return json({
    key: payload.key,
    filename,
    size: object.size,
    contentType,
    uploadedAt,
  }, { status: 201 });
}

async function handleUploadUrl(request: Request, env: Env): Promise<Record<string, unknown>> {
  const payload = await readLimitedJson(request, env);
  const filename = typeof payload.filename === "string" ? sanitizeFilename(payload.filename) : "upload.bin";
  const key = `uploads/pending/${crypto.randomUUID()}-${filename}`;
  const ttlSeconds = parsePositiveInteger(payload.ttlSeconds, 900) ?? 900;
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = await signToken(env, {
    purpose: "upload",
    key,
    expiresAt: expiresAtSeconds,
    filename,
    contentType: typeof payload.contentType === "string" ? payload.contentType : undefined,
  });
  return {
    key,
    method: "PUT",
    uploadUrl: signedUrl(request, "/u", token),
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  };
}

async function handleIngestUrl(request: Request, env: Env): Promise<Record<string, unknown>> {
  const payload = await readLimitedJson(request, env);
  if (typeof payload.url !== "string") {
    throw new UploadError(400, "url_required", "ingest-url requires a url.");
  }
  const sourceUrl = new URL(payload.url);
  if (!["https:", "http:"].includes(sourceUrl.protocol)) {
    throw new UploadError(400, "unsupported_url", "url must be http or https.");
  }
  const upstream = await fetch(sourceUrl.toString());
  if (!upstream.ok || !upstream.body) {
    throw new UploadError(502, "source_fetch_failed", `Source URL returned ${upstream.status}.`);
  }
  const filename =
    typeof payload.filename === "string"
      ? payload.filename
      : sourceUrl.pathname.split("/").filter(Boolean).pop() ?? "download.bin";

  return storeUpload(env, request, {
    filename,
    contentType: typeof payload.contentType === "string" ? payload.contentType : upstream.headers.get("content-type") ?? undefined,
    body: upstream.body,
    metadata: stringMetadata({ source: "url", sourceHost: sourceUrl.host, ...(payload.metadata as Record<string, unknown> | undefined) }),
    temporaryTtlSeconds: parsePositiveInteger(payload.ttlSeconds),
    permanent: payload.permanent === true,
    short: payload.short === true,
    shortName: typeof payload.shortName === "string" ? payload.shortName : undefined,
  });
}

async function handleSign(request: Request, env: Env): Promise<Record<string, unknown>> {
  const payload = await readLimitedJson(request, env);
  if (typeof payload.key !== "string" || payload.key.length === 0) {
    throw new UploadError(400, "key_required", "sign requires a key.");
  }
  const exists = await env.UPLINK_BUCKET.head(payload.key);
  if (!exists) throw new UploadError(404, "not_found", "Object not found.");

  const permanent = payload.permanent === true;
  const ttlSeconds = parsePositiveInteger(payload.ttlSeconds, getDefaultTtl(env)) ?? getDefaultTtl(env);
  const expiresAtSeconds = permanent ? undefined : Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = await signToken(env, { purpose: "download", key: payload.key, expiresAt: expiresAtSeconds });
  const expiresAt = expiresAtSeconds ? new Date(expiresAtSeconds * 1000).toISOString() : undefined;
  const result: Record<string, unknown> = {
    key: payload.key,
    url: signedUrl(request, "/d", token),
    permanent,
    expiresAt,
  };
  const wantsShort = payload.short === true || typeof payload.shortName === "string";
  if (wantsShort) {
    const customName = typeof payload.shortName === "string" ? payload.shortName : undefined;
    try {
      result.shortUrl = await createShortUrl(env, request, token, expiresAt, customName);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "SHORT_NAME_TAKEN") throw new UploadError(409, "short_name_taken", "That custom short URL name is already in use.");
        if (err.message === "INVALID_SHORT_NAME") throw new UploadError(400, "invalid_short_name", "Custom short name must start with a letter or number and contain only letters, numbers, -, or _ (1-64 chars).");
      }
      throw err;
    }
    if (expiresAt) result.shortExpiresAt = expiresAt; // only for non-permanent
  }
  return result;
}

async function handleInfo(env: Env, key: string): Promise<Response> {
  const object = await env.UPLINK_BUCKET.head(key);
  if (!object) return errorJson(404, "not_found", "Object not found.");
  return json(objectInfo(object));
}
