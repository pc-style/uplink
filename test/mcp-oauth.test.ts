import {
  Client,
  type OAuthClientInformationFull,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  auth,
} from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { signPayload } from "../src/signing";
import { testEnv } from "./helpers";
import type { MemoryR2Bucket } from "./memory-r2";

const ORIGIN = "https://uplink.test";
const MCP_URL = `${ORIGIN}/mcp`;

function fetchWorker(request: Request, env: Env): Promise<Response> {
  return worker.fetch(request as Parameters<typeof worker.fetch>[0], env);
}

/** A fetch that routes everything to the Worker, except optional extra hosts (used to host a CIMD document). */
function workerFetch(env: Env, extra: Record<string, () => Response> = {}) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const handler = extra[request.url];
    if (handler) return handler();
    return fetchWorker(request, env);
  };
}

class TestProvider implements OAuthClientProvider {
  redirectedTo: URL | undefined;
  private info: OAuthClientInformationFull | undefined;
  private storedTokens: OAuthTokens | undefined;
  private verifier: string | undefined;
  constructor(
    readonly redirectUrl: string,
    readonly clientMetadataUrl?: string,
  ) {}
  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "uplink test client",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }
  state() {
    return "opaque-state-123";
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationFull) {
    this.info = info;
  }
  tokens() {
    return this.storedTokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.storedTokens = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.redirectedTo = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    if (!this.verifier) throw new Error("no verifier saved");
    return this.verifier;
  }
}

/** Simulates the resource owner approving the consent page with the given API key. */
async function approveConsent(env: Env, authorizeUrl: URL, apiKey: string): Promise<Response> {
  const getPage = await fetchWorker(new Request(authorizeUrl), env);
  expect(getPage.status).toBe(200);
  expect(getPage.headers.get("content-type")).toContain("text/html");
  const form = new URLSearchParams(authorizeUrl.searchParams);
  form.set("decision", "approve");
  form.set("api_key", apiKey);
  return fetchWorker(
    new Request(`${ORIGIN}/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
    env,
  );
}

/** Runs the complete client-side OAuth flow with the official SDK and returns a provider holding tokens. */
async function authorizeWithSdk(env: Env, provider: TestProvider, fetchFn = workerFetch(env)) {
  const first = await auth(provider, { serverUrl: MCP_URL, fetchFn });
  expect(first).toBe("REDIRECT");
  const authorizeUrl = provider.redirectedTo;
  if (!authorizeUrl) throw new Error("no redirect");
  expect(authorizeUrl.origin).toBe(ORIGIN);
  expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorizeUrl.searchParams.get("resource")).toBe(MCP_URL);

  const redirect = await approveConsent(env, authorizeUrl, env.UPLINK_API_KEY);
  expect(redirect.status).toBe(302);
  const callback = new URL(redirect.headers.get("location") ?? "");
  expect(callback.origin + callback.pathname).toBe(provider.redirectUrl);
  expect(callback.searchParams.get("state")).toBe("opaque-state-123");
  expect(callback.searchParams.get("iss")).toBe(ORIGIN);
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();

  const second = await auth(provider, {
    serverUrl: MCP_URL,
    fetchFn,
    authorizationCode: code ?? undefined,
    iss: callback.searchParams.get("iss") ?? undefined,
  });
  expect(second).toBe("AUTHORIZED");
  const tokens = provider.tokens();
  expect(tokens?.access_token).toBeTruthy();
  expect(tokens?.refresh_token).toBeTruthy();
  return provider;
}

async function connectModern(env: Env, provider: OAuthClientProvider | { token: () => Promise<string> }) {
  const client = new Client(
    { name: "uplink-test", version: "0.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: workerFetch(env),
    authProvider: provider,
  });
  await client.connect(transport);
  return client;
}

describe("MCP endpoint discovery and challenge", () => {
  it("returns a 401 with RFC 9728 resource metadata when no credentials are presented", async () => {
    const env = testEnv();
    const response = await fetchWorker(
      new Request(MCP_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }),
      }),
      env,
    );
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("serves protected resource metadata and authorization server metadata", async () => {
    const env = testEnv();
    const prm = await fetchWorker(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`), env);
    expect(prm.status).toBe(200);
    const prmBody = (await prm.json()) as Record<string, unknown>;
    expect(prmBody.resource).toBe(MCP_URL);
    expect(prmBody.authorization_servers).toEqual([ORIGIN]);
    expect(prmBody.scopes_supported).toEqual(["uplink"]);

    const as = await fetchWorker(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), env);
    expect(as.status).toBe(200);
    const asBody = (await as.json()) as Record<string, unknown>;
    expect(asBody.issuer).toBe(ORIGIN);
    expect(asBody.code_challenge_methods_supported).toEqual(["S256"]);
    expect(asBody.client_id_metadata_document_supported).toBe(true);
    expect(asBody.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(asBody.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
  });

  it("answers server/discover with the 2026-07-28 revision for API key clients", async () => {
    const env = testEnv();
    const client = await connectModern(env, { token: async () => env.UPLINK_API_KEY });
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("upload_text");
    await client.close();
  });

  it("still serves 2025-era clients through the legacy initialize handshake", async () => {
    const env = testEnv();
    const client = new Client({ name: "legacy", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: workerFetch(env),
      requestInit: { headers: { "x-api-key": env.UPLINK_API_KEY } },
    });
    await client.connect(transport);
    const result = await client.callTool({ name: "upload_text", arguments: { filename: "legacy.txt", content: "old client" } });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text).filename).toBe("legacy.txt");
    await client.close();
  });
});

describe("OAuth authorization code flow", () => {
  it("authorizes a dynamically registered client and lets it call tools", async () => {
    const env = testEnv();
    const provider = await authorizeWithSdk(env, new TestProvider("http://localhost:3333/callback"));
    expect(provider.clientInformation()?.client_id).toMatch(/^uplink-dcr\./);

    const client = await connectModern(env, provider);
    const result = await client.callTool({
      name: "upload_text",
      arguments: { filename: "oauth.txt", content: "hello via oauth", permanent: true },
    });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    const parsed = JSON.parse(text) as { key: string };
    const bucket = env.UPLINK_BUCKET as unknown as MemoryR2Bucket;
    expect(await bucket.head(parsed.key)).not.toBeNull();
    await client.close();
  });

  it("authorizes a client identified by a Client ID Metadata Document", async () => {
    const env = testEnv();
    const clientId = "https://client.example/oauth/uplink-client.json";
    const redirectUrl = "https://client.example/callback";
    const fetchFn = workerFetch(env, {});
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new Request(input, init).url;
      if (url === clientId) {
        return Response.json({ client_id: clientId, client_name: "CIMD client", redirect_uris: [redirectUrl] });
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    try {
      const provider = await authorizeWithSdk(env, new TestProvider(redirectUrl, clientId), fetchFn);
      expect(provider.clientInformation()?.client_id).toBe(clientId);
      const client = await connectModern(env, provider);
      expect((await client.listTools()).tools.length).toBeGreaterThan(0);
      await client.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refreshes tokens with the refresh_token grant", async () => {
    const env = testEnv();
    const provider = await authorizeWithSdk(env, new TestProvider("http://localhost:3333/callback"));
    const before = provider.tokens();
    const response = await fetchWorker(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: before?.refresh_token ?? "",
          client_id: provider.clientInformation()?.client_id ?? "",
        }).toString(),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as OAuthTokens;
    expect(body.access_token).toBeTruthy();
    expect(body.access_token).not.toBe(before?.access_token);
  });

  it("rejects the consent form when the API key is wrong and never redirects", async () => {
    const env = testEnv();
    const provider = new TestProvider("http://localhost:3333/callback");
    await auth(provider, { serverUrl: MCP_URL, fetchFn: workerFetch(env) });
    const response = await approveConsent(env, provider.redirectedTo as URL, "not-the-key");
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects unregistered redirect URIs without redirecting", async () => {
    const env = testEnv();
    const provider = new TestProvider("http://localhost:3333/callback");
    await auth(provider, { serverUrl: MCP_URL, fetchFn: workerFetch(env) });
    const url = new URL(provider.redirectedTo as URL);
    url.searchParams.set("redirect_uri", "https://attacker.example/steal");
    const response = await fetchWorker(new Request(url), env);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects a code exchange with the wrong PKCE verifier", async () => {
    const env = testEnv();
    const provider = new TestProvider("http://localhost:3333/callback");
    await auth(provider, { serverUrl: MCP_URL, fetchFn: workerFetch(env) });
    const redirect = await approveConsent(env, provider.redirectedTo as URL, env.UPLINK_API_KEY);
    const code = new URL(redirect.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const response = await fetchWorker(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: "x".repeat(50),
          client_id: provider.clientInformation()?.client_id ?? "",
          redirect_uri: provider.redirectUrl,
          resource: MCP_URL,
        }).toString(),
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("rejects replaying an already-exchanged authorization code, even with the correct verifier", async () => {
    const env = testEnv();
    const provider = new TestProvider("http://localhost:3333/callback");
    await auth(provider, { serverUrl: MCP_URL, fetchFn: workerFetch(env) });
    const redirect = await approveConsent(env, provider.redirectedTo as URL, env.UPLINK_API_KEY);
    const code = new URL(redirect.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const tokenRequestBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: provider.codeVerifier(),
      client_id: provider.clientInformation()?.client_id ?? "",
      redirect_uri: provider.redirectUrl,
      resource: MCP_URL,
    }).toString();

    const first = await fetchWorker(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: tokenRequestBody,
      }),
      env,
    );
    expect(first.status).toBe(200);

    const replay = await fetchWorker(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: tokenRequestBody,
      }),
      env,
    );
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("rejects access tokens issued for another resource (RFC 8707 audience binding)", async () => {
    const env = testEnv();
    const foreign = await signPayload(env, {
      t: "access",
      cid: "someone",
      aud: "https://other.example/mcp",
      scope: "uplink",
      exp: Math.floor(Date.now() / 1000) + 600,
      jti: "x",
    });
    const response = await fetchWorker(
      new Request(MCP_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${foreign}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }),
      }),
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("rejects expired access tokens", async () => {
    const env = testEnv();
    const provider = await authorizeWithSdk(env, new TestProvider("http://localhost:3333/callback"));
    const payload = {
      t: "access",
      cid: provider.clientInformation()?.client_id,
      aud: MCP_URL,
      scope: "uplink",
      jti: "expiry-check",
    };
    const connect = async (token: string) => {
      const client = new Client({ name: "t", version: "0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
      const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
        fetch: workerFetch(env),
        authProvider: { token: async () => token },
      });
      await client.connect(transport);
      return client;
    };

    // Control: the same token with a future exp is accepted, so the rejection below is caused by expiry alone.
    const live = await signPayload(env, { ...payload, exp: Math.floor(Date.now() / 1000) + 60 });
    await expect(connect(live)).resolves.toBeDefined();

    const expired = await signPayload(env, { ...payload, exp: Math.floor(Date.now() / 1000) - 5 });
    await expect(connect(expired)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
