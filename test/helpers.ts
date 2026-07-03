import { MemoryR2Bucket } from "./memory-r2";

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    UPLINK_BUCKET: new MemoryR2Bucket() as unknown as R2Bucket,
    UPLINK_API_KEY: "test-api-key",
    UPLINK_SIGNING_SECRET: "test-signing-secret",
    UPLINK_DEFAULT_TTL_SECONDS: "3600",
    UPLINK_MAX_JSON_BYTES: "1048576",
    ...overrides,
  };
}

export function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("authorization", "Bearer test-api-key");
  return headers;
}
