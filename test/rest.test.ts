import { describe, expect, it } from "vitest";
import { handleRest } from "../src/rest";
import { authHeaders, testEnv } from "./helpers";

function ctx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
    exports: {},
  } as unknown as ExecutionContext;
}

function fetchWorker(request: Request, env: Env) {
  return handleRest(request as Request, env);
}

describe("REST API", () => {
  it("rejects unauthenticated uploads", async () => {
    const response = await fetchWorker(
      new Request("https://uplink.test/api/upload", { method: "POST", body: "hello" }),
      testEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("uploads JSON text payloads and downloads through signed URL", async () => {
    const env = testEnv();
    const response = await fetchWorker(
      new Request("https://uplink.test/api/upload", {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          filename: "note.txt",
          encoding: "text",
          content: "hello from json",
          contentType: "text/plain",
          permanent: true,
        }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { key: string; temporaryUrl: string; permanentUrl: string };
    expect(body.key).toMatch(/^uploads\/\d{4}\/\d{2}\/\d{2}\//);
    expect(body.permanentUrl).toContain("/d/");

    const download = await fetchWorker(new Request(body.temporaryUrl), env);
    expect(download.status).toBe(200);
    await expect(download.text()).resolves.toBe("hello from json");
  });

  it("uploads raw streams with x-filename", async () => {
    const env = testEnv();
    const response = await fetchWorker(
      new Request("https://uplink.test/api/upload", {
        method: "POST",
        headers: authHeaders({ "x-filename": "raw.bin", "content-type": "application/octet-stream" }),
        body: "raw content",
      }),
      env,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { filename: string; size: number };
    expect(body.filename).toBe("raw.bin");
    expect(body.size).toBe(11);
  });

  it("creates signed PUT upload URLs", async () => {
    const env = testEnv();
    const response = await fetchWorker(
      new Request("https://uplink.test/api/upload-url", {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ filename: "agent.log", contentType: "text/plain" }),
      }),
      env,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { uploadUrl: string; key: string };

    const put = await fetchWorker(
      new Request(body.uploadUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: "agent bytes" }),
      env,
    );
    expect(put.status).toBe(201);

    const info = await fetchWorker(new Request(`https://uplink.test/api/files/${encodeURIComponent(body.key)}`, { headers: authHeaders() }), env);
    expect(info.status).toBe(200);
    await expect(info.json()).resolves.toMatchObject({ key: body.key, size: 11 });
  });

  it("creates 7-day short URLs when uploading with short=true", async () => {
    const env = testEnv();
    const response = await fetchWorker(
      new Request("https://uplink.test/api/upload", {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          filename: "report.pdf",
          encoding: "text",
          content: "fake pdf content",
          short: true,
        }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { shortUrl: string; shortExpiresAt: string; expiresAt: string };
    expect(body.shortUrl).toMatch(/\/s\/[a-z0-9]+$/i);
    expect(body.shortExpiresAt).toBeDefined();

    // short link must live ~7 days, while the regular temporary one is 1h
    const shortExp = Date.parse(body.shortExpiresAt);
    const tempExp = Date.parse(body.expiresAt);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(shortExp - Date.now()).toBeGreaterThan(sevenDaysMs - 5000);
    expect(tempExp - Date.now()).toBeLessThan(3700 * 1000);

    // Inspect that the short record was stored with the long expiry
    const bucket = env.UPLINK_BUCKET as unknown as { objects: Map<string, { bytes: Uint8Array }> };
    const shortRecord = Array.from(bucket.objects.keys()).find((k) => k.startsWith("short/"));
    expect(shortRecord).toBeDefined();
    const recordText = new TextDecoder().decode(bucket.objects.get(shortRecord!)!.bytes);
    const record = JSON.parse(recordText) as { expiresAt: string };
    expect(Date.parse(record.expiresAt) - Date.now()).toBeGreaterThan(sevenDaysMs - 5000);
  });

  it("supports --permanent + --short for permanent short links (no expiry)", async () => {
    const env = testEnv();
    const response = await fetchWorker(
      new Request("https://uplink.test/api/upload", {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ filename: "permanent.pdf", encoding: "text", content: "x", permanent: true, short: true }),
      }),
      env,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { shortUrl: string; shortExpiresAt?: string; permanentUrl?: string };
    expect(body.shortUrl).toMatch(/\/s\//);
    expect(body.shortExpiresAt).toBeUndefined(); // permanent short has no expiry

    const bucket = env.UPLINK_BUCKET as unknown as { objects: Map<string, { bytes: Uint8Array }> };
    const shortKey = Array.from(bucket.objects.keys()).find((k) => k.startsWith("short/"));
    const record = JSON.parse(new TextDecoder().decode(bucket.objects.get(shortKey!)!.bytes)) as { expiresAt?: string };
    expect(record.expiresAt).toBeUndefined();
  });

  it("supports custom short names via shortName and rejects duplicates (409)", async () => {
    const env = testEnv();

    // First upload with custom name
    const res1 = await fetchWorker(
      new Request("https://uplink.test/api/upload", {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ filename: "a.pdf", encoding: "text", content: "1", shortName: "my-custom" }),
      }),
      env,
    );
    expect(res1.status).toBe(201);
    const b1 = (await res1.json()) as { shortUrl: string };
    expect(b1.shortUrl).toContain("/s/my-custom");

    // Second upload trying same custom name
    const res2 = await fetchWorker(
      new Request("https://uplink.test/api/upload", {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ filename: "b.pdf", encoding: "text", content: "2", shortName: "my-custom" }),
      }),
      env,
    );
    expect(res2.status).toBe(409);
    const err = (await res2.json()) as { error: { code: string } };
    expect(err.error.code).toBe("short_name_taken");

    // Sign endpoint also supports custom short names
    // First create an object we can sign
    const up = await fetchWorker(
      new Request("https://uplink.test/api/upload", {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ filename: "c.pdf", encoding: "text", content: "3" }),
      }),
      env,
    );
    const upBody = (await up.json()) as { key: string };
    const signRes = await fetchWorker(
      new Request("https://uplink.test/api/sign", {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ key: upBody.key, shortName: "signed-custom" }),
      }),
      env,
    );
    expect(signRes.status).toBe(200);
    const signBody = (await signRes.json()) as { shortUrl: string };
    expect(signBody.shortUrl).toContain("/s/signed-custom");
  });
});
