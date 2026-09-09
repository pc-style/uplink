import { verifyApiKey } from "./apikeys";

export function getPresentedApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice("bearer ".length).trim();
  }
  return request.headers.get("x-api-key");
}

export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  return (await verifyApiKey(env, getPresentedApiKey(request))) !== null;
}
