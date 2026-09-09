// Built-in OAuth 2.1 authorization server + resource-server checks for the MCP endpoint.
//
// Follows the MCP 2026-07-28 authorization spec:
// - RFC 9728 Protected Resource Metadata (served by the SDK helper), RFC 8414 AS metadata
// - OAuth 2.1 authorization code + mandatory PKCE (S256), public clients only
// - RFC 8707 resource indicators: tokens are bound to this Worker's /mcp URL
// - RFC 9207 `iss` on the authorization response
// - Client ID Metadata Documents (preferred) and stateless Dynamic Client Registration (deprecated fallback)
//
// Everything is stateless: codes, tokens, and DCR client IDs are HMAC-signed with UPLINK_SIGNING_SECRET.
// "Logging in" means proving you hold the deployment's API key. Rotating the signing secret revokes everything.
import {
  type AuthInfo,
  type OAuthMetadata,
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  verifyBearerToken,
} from "@modelcontextprotocol/server";
import { verifyApiKey } from "./apikeys";
import { getPresentedApiKey } from "./auth";
import { bytesToBase64Url } from "./base64url";
import { safeEqualString, sha256Bytes } from "./crypto";
import { json } from "./http";
import { signPayload, verifyPayload } from "./signing";

export const MCP_PATH = "/mcp";
export const OAUTH_SCOPE = "uplink";
const AUTHORIZE_PATH = "/oauth/authorize";
const TOKEN_PATH = "/oauth/token";
const REGISTER_PATH = "/oauth/register";
const CODE_TTL_SECONDS = 5 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const DCR_CLIENT_PREFIX = "uplink-dcr.";
const CIMD_FETCH_TIMEOUT_MS = 5000;
const CIMD_MAX_BODY_BYTES = 16 * 1024;

type CodePayload = { t: "code"; cid: string; ru: string; cc: string; aud: string; scope: string; exp: number };
type AccessPayload = { t: "access"; cid: string; aud: string; scope: string; exp: number; jti: string };
type RefreshPayload = { t: "refresh"; cid: string; aud: string; scope: string; exp: number; jti: string };
type DcrClientPayload = { t: "client"; ru: string[]; name?: string; iat: number };

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function issuerUrl(request: Request): URL {
  const url = new URL(request.url);
  return new URL(url.origin);
}

export function resourceUrl(request: Request): URL {
  return new URL(MCP_PATH, issuerUrl(request));
}

export function authorizationServerMetadata(issuer: URL): OAuthMetadata {
  return {
    issuer: issuer.origin,
    authorization_endpoint: new URL(AUTHORIZE_PATH, issuer).toString(),
    token_endpoint: new URL(TOKEN_PATH, issuer).toString(),
    registration_endpoint: new URL(REGISTER_PATH, issuer).toString(),
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

function metadataOptions(request: Request) {
  const issuer = issuerUrl(request);
  const loopback = issuer.hostname === "localhost" || issuer.hostname === "127.0.0.1" || issuer.hostname === "[::1]";
  return {
    oauthMetadata: authorizationServerMetadata(issuer),
    resourceServerUrl: resourceUrl(request),
    resourceName: "up!link",
    scopesSupported: [OAUTH_SCOPE],
    // Plain http is only acceptable for local wrangler dev; any other http issuer is a misconfiguration.
    dangerouslyAllowInsecureIssuerUrl: issuer.protocol === "http:" && loopback,
  };
}

// ---------------------------------------------------------------------------
// Resource server: authenticate a request to /mcp
// ---------------------------------------------------------------------------

/**
 * Returns AuthInfo when the request carries the API key or a valid OAuth access token
 * issued for this resource, otherwise the 401/403 challenge Response to return.
 */
export async function authenticateMcpRequest(request: Request, env: Env): Promise<AuthInfo | Response> {
  const apiKey = await verifyApiKey(env, getPresentedApiKey(request));
  if (apiKey) {
    return {
      token: getPresentedApiKey(request) ?? "",
      clientId: `api-key:${apiKey.label}`,
      scopes: [OAUTH_SCOPE],
      expiresAt: nowSeconds() + ACCESS_TOKEN_TTL_SECONDS,
      resource: resourceUrl(request),
      extra: { method: "api-key" },
    };
  }

  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl(request));
  const expectedAudience = resourceUrl(request).toString();
  const verifier = {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const payload = await verifyPayload(env, token);
      if (!isAccessPayload(payload)) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token.");
      }
      if (payload.aud !== expectedAudience) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token was not issued for this resource.");
      }
      return {
        token,
        clientId: payload.cid,
        scopes: payload.scope.split(" ").filter(Boolean),
        expiresAt: payload.exp,
        resource: new URL(payload.aud),
        extra: { method: "oauth", jti: payload.jti },
      };
    },
  };

  try {
    return await verifyBearerToken(request.headers.get("authorization"), {
      verifier,
      requiredScopes: [OAUTH_SCOPE],
      resourceMetadataUrl,
    });
  } catch (error) {
    return bearerAuthChallengeResponse(error, { requiredScopes: [OAUTH_SCOPE], resourceMetadataUrl });
  }
}

function isAccessPayload(value: unknown): value is AccessPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as AccessPayload).t === "access" &&
    typeof (value as AccessPayload).cid === "string" &&
    typeof (value as AccessPayload).aud === "string" &&
    typeof (value as AccessPayload).scope === "string" &&
    Number.isInteger((value as AccessPayload).exp) &&
    typeof (value as AccessPayload).jti === "string"
  );
}

// ---------------------------------------------------------------------------
// Authorization server routes
// ---------------------------------------------------------------------------

/** Handles well-known metadata and /oauth/* routes; returns null when the path is not an OAuth route. */
export async function handleOAuth(request: Request, env: Env): Promise<Response | null> {
  const wellKnown = oauthMetadataResponse(request, metadataOptions(request));
  if (wellKnown) return wellKnown;

  const url = new URL(request.url);
  if (url.pathname === AUTHORIZE_PATH) return handleAuthorize(request, env);
  if (url.pathname === TOKEN_PATH) return withCors(request, () => handleToken(request, env));
  if (url.pathname === REGISTER_PATH) return withCors(request, () => handleRegister(request, env));
  return null;
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
  };
}

async function withCors(request: Request, next: () => Promise<Response>): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  const response = await next();
  for (const [name, value] of Object.entries(corsHeaders())) response.headers.set(name, value);
  return response;
}

function oauthErrorResponse(status: number, code: string, description: string, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store");
  headers.set("pragma", "no-cache");
  return json({ error: code, error_description: description }, { status, headers });
}

// --- client identity -------------------------------------------------------

type ResolvedClient = { clientId: string; redirectUris: string[]; name?: string };

function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  }
  // Private-use URI schemes for native apps (RFC 8252 §7.1), e.g. com.example.app:/callback
  return /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol) && url.protocol.includes(".");
}

// Reads a response body up to maxBytes, returning null (instead of buffering further) if it's exceeded.
async function readBodyWithLimit(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(concatBytes(chunks, total));
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function resolveClient(env: Env, clientId: string): Promise<ResolvedClient | null> {
  if (clientId.startsWith(DCR_CLIENT_PREFIX)) {
    const payload = await verifyPayload(env, clientId.slice(DCR_CLIENT_PREFIX.length));
    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as DcrClientPayload).t !== "client" ||
      !Array.isArray((payload as DcrClientPayload).ru)
    ) {
      return null;
    }
    const client = payload as DcrClientPayload;
    return { clientId, redirectUris: client.ru.filter((uri) => typeof uri === "string"), name: client.name };
  }

  // Client ID Metadata Document: client_id is an https URL with a non-root path hosting a JSON document.
  let metadataUrl: URL;
  try {
    metadataUrl = new URL(clientId);
  } catch {
    return null;
  }
  if (metadataUrl.protocol !== "https:" || metadataUrl.pathname === "/" || metadataUrl.hash || metadataUrl.username) {
    return null;
  }
  let document: unknown;
  try {
    const response = await fetch(metadataUrl.toString(), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(CIMD_FETCH_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) return null;
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > CIMD_MAX_BODY_BYTES) return null;
    const text = await readBodyWithLimit(response.body, CIMD_MAX_BODY_BYTES);
    if (text === null) return null;
    document = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof document !== "object" || document === null) return null;
  const record = document as Record<string, unknown>;
  if (record.client_id !== clientId || !Array.isArray(record.redirect_uris)) return null;
  const redirectUris = record.redirect_uris.filter((uri): uri is string => typeof uri === "string");
  return {
    clientId,
    redirectUris,
    name: typeof record.client_name === "string" ? record.client_name.slice(0, 120) : undefined,
  };
}

// --- dynamic client registration (RFC 7591, deprecated in MCP 2026-07-28, kept for older clients) ---

async function handleRegister(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return oauthErrorResponse(405, "invalid_request", "Use POST.", { allow: "POST, OPTIONS" });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthErrorResponse(400, "invalid_client_metadata", "Body must be JSON.");
  }
  if (typeof body !== "object" || body === null) {
    return oauthErrorResponse(400, "invalid_client_metadata", "Body must be a JSON object.");
  }
  const metadata = body as Record<string, unknown>;
  const redirectUris = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris : [];
  if (redirectUris.length === 0 || redirectUris.length > 10) {
    return oauthErrorResponse(400, "invalid_redirect_uri", "Provide 1-10 redirect_uris.");
  }
  for (const uri of redirectUris) {
    if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
      return oauthErrorResponse(400, "invalid_redirect_uri", `Redirect URI not allowed: ${String(uri)}`);
    }
  }
  const authMethod = metadata.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== "none") {
    return oauthErrorResponse(400, "invalid_client_metadata", "Only public clients (token_endpoint_auth_method: none) are supported.");
  }
  const name = typeof metadata.client_name === "string" ? metadata.client_name.slice(0, 120) : undefined;
  const issuedAt = nowSeconds();
  const payload: DcrClientPayload = { t: "client", ru: redirectUris as string[], name, iat: issuedAt };
  const clientId = `${DCR_CLIENT_PREFIX}${await signPayload(env, payload)}`;

  return json(
    {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      redirect_uris: redirectUris,
      client_name: name,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: OAUTH_SCOPE,
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}

// --- authorization endpoint -----------------------------------------------

type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scope: string;
  resource: string;
};

type AuthorizeValidation =
  | { ok: true; params: AuthorizeParams; client: ResolvedClient }
  | { ok: false; redirectable: false; error: string; description: string }
  | { ok: false; redirectable: true; redirectUri: string; state?: string; error: string; description: string };

async function validateAuthorizeParams(request: Request, env: Env, input: URLSearchParams): Promise<AuthorizeValidation> {
  const clientId = input.get("client_id") ?? "";
  const redirectUri = input.get("redirect_uri") ?? "";
  if (!clientId) return { ok: false, redirectable: false, error: "invalid_request", description: "client_id is required." };

  const client = await resolveClient(env, clientId);
  if (!client) return { ok: false, redirectable: false, error: "invalid_client", description: "Unknown client_id." };
  if (!redirectUri || !client.redirectUris.includes(redirectUri) || !isAllowedRedirectUri(redirectUri)) {
    return { ok: false, redirectable: false, error: "invalid_request", description: "redirect_uri is not registered for this client." };
  }

  const state = input.get("state") ?? undefined;
  const fail = (error: string, description: string): AuthorizeValidation => ({
    ok: false,
    redirectable: true,
    redirectUri,
    state,
    error,
    description,
  });

  if (input.get("response_type") !== "code") return fail("unsupported_response_type", "response_type must be code.");
  const codeChallenge = input.get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return fail("invalid_request", "A PKCE code_challenge is required.");
  if ((input.get("code_challenge_method") ?? "") !== "S256") return fail("invalid_request", "code_challenge_method must be S256.");

  const requestedScopes = (input.get("scope") ?? "").split(" ").filter(Boolean);
  if (requestedScopes.some((scope) => scope !== OAUTH_SCOPE)) return fail("invalid_scope", `Only the ${OAUTH_SCOPE} scope is available.`);

  const expectedResource = resourceUrl(request).toString();
  const resource = input.get("resource") ?? expectedResource;
  if (resource !== expectedResource) return fail("invalid_target", `resource must be ${expectedResource}.`);

  return { ok: true, params: { clientId, redirectUri, state, codeChallenge, scope: OAUTH_SCOPE, resource }, client };
}

function redirectWithParams(redirectUri: string, params: Record<string, string | undefined>): Response {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  return new Response(null, { status: 302, headers: { location: url.toString(), "cache-control": "no-store" } });
}

function authorizeFailure(validation: Exclude<AuthorizeValidation, { ok: true }>): Response {
  if (validation.redirectable) {
    return redirectWithParams(validation.redirectUri, {
      error: validation.error,
      error_description: validation.description,
      state: validation.state,
    });
  }
  return htmlResponse(400, renderErrorPage(validation.error, validation.description));
}

async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const validation = await validateAuthorizeParams(request, env, new URL(request.url).searchParams);
    if (!validation.ok) return authorizeFailure(validation);
    return htmlResponse(200, renderConsentPage(validation.params, validation.client));
  }

  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  }

  const form = new URLSearchParams(await request.text());
  const validation = await validateAuthorizeParams(request, env, form);
  if (!validation.ok) return authorizeFailure(validation);

  const decision = form.get("decision");
  if (decision !== "approve") {
    return redirectWithParams(validation.params.redirectUri, {
      error: "access_denied",
      error_description: "The user denied the request.",
      state: validation.params.state,
    });
  }

  const presentedKey = form.get("api_key")?.trim() ?? "";
  if (!(await verifyApiKey(env, presentedKey))) {
    return htmlResponse(401, renderConsentPage(validation.params, validation.client, "That API key is not valid for this deployment."));
  }

  const payload: CodePayload = {
    t: "code",
    cid: validation.params.clientId,
    ru: validation.params.redirectUri,
    cc: validation.params.codeChallenge,
    aud: validation.params.resource,
    scope: validation.params.scope,
    exp: nowSeconds() + CODE_TTL_SECONDS,
  };
  const code = await signPayload(env, payload);
  return redirectWithParams(validation.params.redirectUri, {
    code,
    state: validation.params.state,
    iss: issuerUrl(request).origin,
  });
}

// --- token endpoint ---------------------------------------------------------

async function handleToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return oauthErrorResponse(405, "invalid_request", "Use POST.", { allow: "POST, OPTIONS" });
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthErrorResponse(400, "invalid_request", "Body must be application/x-www-form-urlencoded.");
  }
  const form = new URLSearchParams(await request.text());
  const grantType = form.get("grant_type");
  const clientId = form.get("client_id") ?? "";
  if (!clientId) return oauthErrorResponse(401, "invalid_client", "client_id is required.");
  if (request.headers.get("authorization")) {
    return oauthErrorResponse(401, "invalid_client", "This server only issues tokens to public clients; do not send client credentials.");
  }
  const expectedResource = resourceUrl(request).toString();
  const requestedResource = form.get("resource");
  if (requestedResource !== null && requestedResource !== expectedResource) {
    return oauthErrorResponse(400, "invalid_target", `resource must be ${expectedResource}.`);
  }

  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    const payload = await verifyPayload(env, code);
    if (!isCodePayload(payload) || payload.exp < nowSeconds()) {
      return oauthErrorResponse(400, "invalid_grant", "Authorization code is invalid or expired.");
    }
    if (payload.cid !== clientId) return oauthErrorResponse(400, "invalid_grant", "Authorization code was issued to another client.");
    const redirectUri = form.get("redirect_uri");
    if (redirectUri !== null && redirectUri !== payload.ru) {
      return oauthErrorResponse(400, "invalid_grant", "redirect_uri does not match the authorization request.");
    }
    if (payload.aud !== expectedResource) return oauthErrorResponse(400, "invalid_target", "Authorization code was issued for another resource.");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthErrorResponse(400, "invalid_grant", "code_verifier is required.");
    const challenge = bytesToBase64Url(await sha256Bytes(verifier));
    if (!(await safeEqualString(challenge, payload.cc))) return oauthErrorResponse(400, "invalid_grant", "PKCE verification failed.");
    return issueTokens(env, { clientId, audience: payload.aud, scope: payload.scope });
  }

  if (grantType === "refresh_token") {
    const payload = await verifyPayload(env, form.get("refresh_token") ?? "");
    if (!isRefreshPayload(payload) || payload.exp < nowSeconds()) {
      return oauthErrorResponse(400, "invalid_grant", "Refresh token is invalid or expired.");
    }
    if (payload.cid !== clientId) return oauthErrorResponse(400, "invalid_grant", "Refresh token was issued to another client.");
    if (payload.aud !== expectedResource) return oauthErrorResponse(400, "invalid_target", "Refresh token was issued for another resource.");
    const requestedScopes = (form.get("scope") ?? "").split(" ").filter(Boolean);
    const granted = payload.scope.split(" ").filter(Boolean);
    if (requestedScopes.some((scope) => !granted.includes(scope))) {
      return oauthErrorResponse(400, "invalid_scope", "Requested scope exceeds the original grant.");
    }
    return issueTokens(env, { clientId, audience: payload.aud, scope: payload.scope });
  }

  return oauthErrorResponse(400, "unsupported_grant_type", "Supported grant types: authorization_code, refresh_token.");
}

async function issueTokens(env: Env, grant: { clientId: string; audience: string; scope: string }): Promise<Response> {
  const issuedAt = nowSeconds();
  const access: AccessPayload = {
    t: "access",
    cid: grant.clientId,
    aud: grant.audience,
    scope: grant.scope,
    exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID(),
  };
  const refresh: RefreshPayload = {
    t: "refresh",
    cid: grant.clientId,
    aud: grant.audience,
    scope: grant.scope,
    exp: issuedAt + REFRESH_TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID(),
  };
  return json(
    {
      access_token: await signPayload(env, access),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: await signPayload(env, refresh),
      scope: grant.scope,
    },
    { headers: { "cache-control": "no-store", pragma: "no-cache" } },
  );
}

function isCodePayload(value: unknown): value is CodePayload {
  const v = value as CodePayload;
  return (
    typeof value === "object" &&
    value !== null &&
    v.t === "code" &&
    typeof v.cid === "string" &&
    typeof v.ru === "string" &&
    typeof v.cc === "string" &&
    typeof v.aud === "string" &&
    typeof v.scope === "string" &&
    Number.isInteger(v.exp)
  );
}

function isRefreshPayload(value: unknown): value is RefreshPayload {
  const v = value as RefreshPayload;
  return (
    typeof value === "object" &&
    value !== null &&
    v.t === "refresh" &&
    typeof v.cid === "string" &&
    typeof v.aud === "string" &&
    typeof v.scope === "string" &&
    Number.isInteger(v.exp) &&
    typeof v.jti === "string"
  );
}

// --- HTML ------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}

const PAGE_STYLE = `
  body { font: 15px/1.5 system-ui, sans-serif; background: #0e0e10; color: #eaeaea; margin: 0; display: grid; place-items: center; min-height: 100vh; }
  main { width: min(28rem, 92vw); background: #17171a; border: 1px solid #2a2a2e; border-radius: 12px; padding: 1.5rem; }
  h1 { font-size: 1.15rem; margin: 0 0 .5rem; }
  p { margin: .5rem 0; color: #b8b8bd; }
  code { background: #232327; padding: .1rem .35rem; border-radius: 4px; word-break: break-all; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: .6rem .7rem; border-radius: 8px; border: 1px solid #333; background: #0e0e10; color: #eaeaea; margin: .5rem 0 1rem; }
  .row { display: flex; gap: .5rem; }
  button { flex: 1; padding: .6rem; border-radius: 8px; border: 1px solid #333; background: #232327; color: #eaeaea; cursor: pointer; }
  button.primary { background: #3b82f6; border-color: #3b82f6; color: white; }
  .error { color: #f87171; }
`;

function renderConsentPage(params: AuthorizeParams, client: ResolvedClient, error?: string): string {
  const fields: [string, string][] = [
    ["response_type", "code"],
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["code_challenge", params.codeChallenge],
    ["code_challenge_method", "S256"],
    ["scope", params.scope],
    ["resource", params.resource],
  ];
  if (params.state !== undefined) fields.push(["state", params.state]);
  const hidden = fields
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("\n");
  const clientLabel = client.name ? `<strong>${escapeHtml(client.name)}</strong> (<code>${escapeHtml(client.clientId)}</code>)` : `<code>${escapeHtml(client.clientId)}</code>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>up!link · authorize</title><style>${PAGE_STYLE}</style></head>
<body><main>
<h1>Authorize access to up!link</h1>
<p>${clientLabel} wants to upload files and mint links through this up!link server.</p>
<p>It will be redirected to <code>${escapeHtml(params.redirectUri)}</code>.</p>
<form method="post" action="${AUTHORIZE_PATH}">
${hidden}
<label for="api_key">Enter this deployment's API key to approve</label>
<input id="api_key" name="api_key" type="password" autocomplete="off" required autofocus>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<div class="row">
<button type="submit" name="decision" value="deny">Deny</button>
<button type="submit" name="decision" value="approve" class="primary">Approve</button>
</div>
</form>
</main></body></html>`;
}

function renderErrorPage(error: string, description: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>up!link · error</title><style>${PAGE_STYLE}</style></head>
<body><main><h1>Authorization request rejected</h1><p class="error"><code>${escapeHtml(error)}</code></p><p>${escapeHtml(description)}</p></main></body></html>`;
}
