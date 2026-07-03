import { handleMcp } from "./mcp";
import { handleRest } from "./rest";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return handleMcp(request, env, ctx);
    }
    return handleRest(request, env);
  },
} satisfies ExportedHandler<Env>;
