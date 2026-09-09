import { describe, expect, it } from "vitest";
import { mintSignedApiKey, verifyApiKey } from "../src/apikeys";
import { isAuthorized } from "../src/auth";
import { testEnv } from "./helpers";

describe("signed API keys", () => {
  it("mints uplink_<host>_<secret> keys whose secret part has no underscore", async () => {
    const key = await mintSignedApiKey("s", "uplink.example.workers.dev", "ci-bot");
    expect(key.startsWith("uplink_uplink.example.workers.dev_")).toBe(true);
    const secretPart = key.slice(key.lastIndexOf("_") + 1);
    expect(secretPart).not.toContain("_");
    expect(secretPart.split(".")).toHaveLength(3);
  });

  it("accepts a signed key and reports its label; the static key is 'default'", async () => {
    const env = testEnv();
    const key = await mintSignedApiKey(env.UPLINK_SIGNING_SECRET, "uplink.test", "ci-bot");
    expect(await verifyApiKey(env, key)).toEqual({ label: "ci-bot" });
    expect(await verifyApiKey(env, env.UPLINK_API_KEY)).toEqual({ label: "default" });
    expect(await isAuthorized(new Request("https://uplink.test/api/files/x", { headers: { "x-api-key": key } }), env)).toBe(
      true,
    );
  });

  it("rejects keys signed with another secret, tampered labels, and junk", async () => {
    const env = testEnv();
    const foreign = await mintSignedApiKey("other-secret", "uplink.test", "ci-bot");
    expect(await verifyApiKey(env, foreign)).toBeNull();

    const key = await mintSignedApiKey(env.UPLINK_SIGNING_SECRET, "uplink.test", "ci-bot");
    expect(await verifyApiKey(env, key.replace("_ci-bot.", "_admin."))).toBeNull();
    expect(await verifyApiKey(env, "uplink_uplink.test_nope")).toBeNull();
    expect(await verifyApiKey(env, "")).toBeNull();
    expect(await verifyApiKey(env, null)).toBeNull();
  });

  it("uses distinct nonces so two keys with the same label differ", async () => {
    const a = await mintSignedApiKey("s", "h", "x");
    const b = await mintSignedApiKey("s", "h", "x");
    expect(a).not.toBe(b);
  });

  it("rejects invalid labels", async () => {
    await expect(mintSignedApiKey("s", "h", "Bad_Label")).rejects.toThrow();
  });
});
