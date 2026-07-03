export type JsonRecord = Record<string, unknown>;

export function json(data: JsonRecord, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorJson(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, { status });
}

export function methodNotAllowed(allow: string[]): Response {
  return new Response(null, {
    status: 405,
    headers: {
      allow: allow.join(", "),
    },
  });
}

export function notFound(): Response {
  return errorJson(404, "not_found", "Route not found.");
}
