export async function apiRequest(
  method: string,
  url: string,
  apiKey: string,
  body?: FormData | Record<string, unknown>,
): Promise<Response> {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${apiKey}`);

  let fetchBody: string | FormData | undefined;
  if (body instanceof FormData) {
    fetchBody = body;
  } else if (body !== undefined) {
    headers.set("content-type", "application/json; charset=utf-8");
    fetchBody = JSON.stringify(body);
  }

  return fetch(url, {
    method,
    headers,
    body: fetchBody,
  });
}

export function errorExit(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}
