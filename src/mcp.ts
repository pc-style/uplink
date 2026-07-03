import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";
import { isAuthorized } from "./auth";
import { bytesToBase64 } from "./base64url";
import { json } from "./http";
import { UPLINK_MCP_TOOL_NAMES } from "./mcp-tools";
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
  const server = new McpServer({
    name: "up!link",
    version: "0.1.0",
  });

  server.registerTool(
    UPLINK_MCP_TOOL_NAMES[0],
    {
      description: "Upload a file payload to private R2 storage. Use base64 for binary content and text for UTF-8 content.",
      inputSchema: {
        filename: z.string().min(1).describe("Original filename to preserve in metadata."),
        encoding: z.enum(["base64", "text"]).describe("How content is encoded."),
        content: z.string().describe("File content as base64 or plain text."),
        contentType: z.string().optional().describe("MIME type to store with the object."),
        metadata: metadataSchema.describe("Optional lightweight metadata values."),
        ttlSeconds: z.number().int().positive().optional().describe("Temporary download URL TTL in seconds."),
        permanent: z.boolean().optional().describe("Also return a non-expiring signed Worker URL."),
      },
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
      inputSchema: {
        filename: z.string().min(1),
        content: z.string(),
        contentType: z.string().optional().default("text/plain; charset=utf-8"),
        metadata: metadataSchema,
        ttlSeconds: z.number().int().positive().optional(),
        permanent: z.boolean().optional(),
      },
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
      inputSchema: {
        url: z.string().url(),
        filename: z.string().optional(),
        contentType: z.string().optional(),
        metadata: metadataSchema,
        ttlSeconds: z.number().int().positive().optional(),
        permanent: z.boolean().optional(),
      },
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
      inputSchema: {
        filename: z.string().min(1),
        contentType: z.string().optional(),
        ttlSeconds: z.number().int().positive().optional(),
      },
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
      inputSchema: {
        key: z.string().min(1),
        ttlSeconds: z.number().int().positive().optional(),
        permanent: z.boolean().optional(),
      },
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
      inputSchema: {
        key: z.string().min(1),
      },
    },
    async ({ key }) => {
      const object = await env.UPLINK_BUCKET.head(key);
      if (!object) throw new Error("Object not found.");
      return toolText(objectInfo(object));
    },
  );

  return server;
}

export async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!(await isAuthorized(request, env))) {
    return json({ error: { code: "unauthorized", message: "Missing or invalid API key." } }, { status: 401 });
  }
  const server = createUplinkMcpServer(env, request);
  return createMcpHandler(server, { route: "/mcp", enableJsonResponse: true })(request, env, ctx);
}

export function mcpFileResourceContent(bytes: Uint8Array, mimeType: string) {
  return { blob: bytesToBase64(bytes), mimeType };
}
