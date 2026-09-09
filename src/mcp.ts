import { type AuthInfo, McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { bytesToBase64 } from "./base64url";
import { UPLINK_MCP_TOOL_NAMES } from "./mcp-tools";
import { authenticateMcpRequest } from "./oauth";
import { signToken, signedUrl } from "./signing";
import { getDefaultTtl, objectInfo, sanitizeFilename, storeUpload, stringMetadata } from "./storage";
import { parsePositiveInteger } from "./uploads";

const metadataSchema = z.record(z.string(), z.unknown()).optional();

function toolText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function createUplinkMcpServer(env: Env, request: Request): McpServer {
  const server = new McpServer(
    { name: "up!link", version: "0.1.0" },
    {
      instructions:
        "Upload files or text to private storage and receive signed download links. Prefer upload_text for UTF-8 content and upload_file with base64 for binary data.",
    },
  );

  server.registerTool(
    UPLINK_MCP_TOOL_NAMES[0],
    {
      description: "Upload a file payload to private R2 storage. Use base64 for binary content and text for UTF-8 content.",
      inputSchema: z.object({
        filename: z.string().min(1).describe("Original filename to preserve in metadata."),
        encoding: z.enum(["base64", "text"]).describe("How content is encoded."),
        content: z.string().describe("File content as base64 or plain text."),
        contentType: z.string().optional().describe("MIME type to store with the object."),
        metadata: metadataSchema.describe("Optional lightweight metadata values."),
        ttlSeconds: z.number().int().positive().optional().describe("Temporary download URL TTL in seconds."),
        permanent: z.boolean().optional().describe("Also return a non-expiring signed Worker URL."),
      }),
    },
    async ({ filename, encoding, content, contentType, metadata, ttlSeconds, permanent }) => {
      const body = encoding === "base64" ? decodeBase64(content) : content;
      return toolText(
        await storeUpload(env, request, {
          filename,
          contentType,
          body,
          metadata: stringMetadata(metadata),
          temporaryTtlSeconds: ttlSeconds,
          permanent,
        }),
      );
    },
  );

  server.registerTool(
    UPLINK_MCP_TOOL_NAMES[1],
    {
      description: "Upload UTF-8 text content to private R2 storage.",
      inputSchema: z.object({
        filename: z.string().min(1),
        content: z.string(),
        contentType: z.string().optional().default("text/plain; charset=utf-8"),
        metadata: metadataSchema,
        ttlSeconds: z.number().int().positive().optional(),
        permanent: z.boolean().optional(),
      }),
    },
    async ({ filename, content, contentType, metadata, ttlSeconds, permanent }) =>
      toolText(
        await storeUpload(env, request, {
          filename,
          contentType,
          body: content,
          metadata: stringMetadata(metadata),
          temporaryTtlSeconds: ttlSeconds,
          permanent,
        }),
      ),
  );

  server.registerTool(
    UPLINK_MCP_TOOL_NAMES[2],
    {
      description: "Fetch a short-lived source URL and store the response body privately in R2.",
      inputSchema: z.object({
        url: z.string().url(),
        filename: z.string().optional(),
        contentType: z.string().optional(),
        metadata: metadataSchema,
        ttlSeconds: z.number().int().positive().optional(),
        permanent: z.boolean().optional(),
      }),
    },
    async ({ url, filename, contentType, metadata, ttlSeconds, permanent }) => {
      const source = new URL(url);
      const upstream = await fetch(source.toString());
      if (!upstream.ok || !upstream.body) {
        throw new Error(`Source URL returned ${upstream.status}.`);
      }
      return toolText(
        await storeUpload(env, request, {
          filename: filename ?? source.pathname.split("/").filter(Boolean).pop() ?? "download.bin",
          contentType: contentType ?? upstream.headers.get("content-type") ?? undefined,
          body: upstream.body,
          metadata: stringMetadata({ source: "url", sourceHost: source.host, ...metadata }),
          temporaryTtlSeconds: ttlSeconds,
          permanent,
        }),
      );
    },
  );

  server.registerTool(
    UPLINK_MCP_TOOL_NAMES[3],
    {
      description: "Create a temporary signed PUT URL so a constrained agent can stream bytes without receiving the main API key.",
      inputSchema: z.object({
        filename: z.string().min(1),
        contentType: z.string().optional(),
        ttlSeconds: z.number().int().positive().optional(),
      }),
    },
    async ({ filename, contentType, ttlSeconds }) => {
      const safeFilename = sanitizeFilename(filename);
      const key = `uploads/pending/${crypto.randomUUID()}-${safeFilename}`;
      const ttl = parsePositiveInteger(ttlSeconds, 900) ?? 900;
      const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttl;
      const token = await signToken(env, {
        purpose: "upload",
        key,
        expiresAt: expiresAtSeconds,
        filename: safeFilename,
        contentType,
      });
      return toolText({
        key,
        method: "PUT",
        uploadUrl: signedUrl(request, "/u", token),
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      });
    },
  );

  server.registerTool(
    UPLINK_MCP_TOOL_NAMES[4],
    {
      description: "Create a temporary or permanent signed Worker download URL for an existing object key.",
      inputSchema: z.object({
        key: z.string().min(1),
        ttlSeconds: z.number().int().positive().optional(),
        permanent: z.boolean().optional(),
      }),
    },
    async ({ key, ttlSeconds, permanent }) => {
      const object = await env.UPLINK_BUCKET.head(key);
      if (!object) throw new Error("Object not found.");
      const ttl = ttlSeconds ?? getDefaultTtl(env);
      const expiresAtSeconds = permanent ? undefined : Math.floor(Date.now() / 1000) + ttl;
      const token = await signToken(env, { purpose: "download", key, expiresAt: expiresAtSeconds });
      return toolText({
        key,
        url: signedUrl(request, "/d", token),
        permanent: permanent === true,
        expiresAt: expiresAtSeconds ? new Date(expiresAtSeconds * 1000).toISOString() : undefined,
      });
    },
  );

  server.registerTool(
    UPLINK_MCP_TOOL_NAMES[5],
    {
      description: "Return metadata for a private R2 object without exposing object bytes.",
      inputSchema: z.object({
        key: z.string().min(1),
      }),
    },
    async ({ key }) => {
      const object = await env.UPLINK_BUCKET.head(key);
      if (!object) throw new Error("Object not found.");
      return toolText(objectInfo(object));
    },
  );

  return server;
}

const MCP_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-api-key, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-protocol-version, mcp-session-id, www-authenticate",
  "access-control-max-age": "86400",
};

/**
 * Serves the MCP endpoint. Speaks the 2026-07-28 stateless protocol (per-request `_meta` envelope,
 * `server/discover`) and falls back to stateless 2025-era Streamable HTTP for older clients.
 * Requires either the API key or an OAuth access token issued by this Worker.
 */
export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });

  const auth = await authenticateMcpRequest(request, env);
  if (auth instanceof Response) return withMcpCors(auth);

  const handler = createMcpHandler(() => createUplinkMcpServer(env, request), {
    legacy: "stateless",
    onerror: (error) => console.error("mcp:", error),
  });
  // Not closed explicitly: close() aborts in-flight exchanges, and a streamed body may still be draining.
  return withMcpCors(await handler.fetch(request, { authInfo: auth satisfies AuthInfo }));
}

function withMcpCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function mcpFileResourceContent(bytes: Uint8Array, mimeType: string) {
  return { blob: bytesToBase64(bytes), mimeType };
}
