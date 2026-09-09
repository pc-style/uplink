import { handleMcp } from "./mcp";
import { MCP_PATH, handleOAuth } from "./oauth";
import { handleRest } from "./rest";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === MCP_PATH) {
      return handleMcp(request, env);
    }
    const oauth = await handleOAuth(request, env);
    if (oauth) return oauth;
    return handleRest(request, env);
  },
} satisfies ExportedHandler<Env>;
