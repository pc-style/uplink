import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "../src/signing";
import { testEnv } from "./helpers";

describe("signed tokens", () => {
  it("validates temporary download tokens", async () => {
    const env = testEnv();
    const token = await signToken(env, { purpose: "download", key: "uploads/a.txt", expiresAt: 200 });

    await expect(verifyToken(env, token, "download", 100)).resolves.toMatchObject({ key: "uploads/a.txt" });
    await expect(verifyToken(env, token, "download", 201)).resolves.toBeNull();
  });

  it("validates permanent tokens without expiry", async () => {
    const env = testEnv();
    const token = await signToken(env, { purpose: "download", key: "uploads/a.txt" });

    await expect(verifyToken(env, token, "download", 999999999)).resolves.toMatchObject({ key: "uploads/a.txt" });
  });

  it("rejects tampered tokens", async () => {
    const env = testEnv();
    const token = await signToken(env, { purpose: "download", key: "uploads/a.txt" });

    await expect(verifyToken(env, `${token}x`, "download")).resolves.toBeNull();
  });
});
