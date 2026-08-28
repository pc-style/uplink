import { test, expect } from "bun:test";
import { serverFromKey } from "./config";

test("serverFromKey derives the server from composite keys", () => {
  expect(serverFromKey("uplink_uplink.demo.workers.dev_abc123")).toBe(
    "https://uplink.demo.workers.dev",
  );
  expect(serverFromKey("uplink_files.example.com_deadbeef")).toBe("https://files.example.com");
});

test("serverFromKey returns empty for legacy or malformed keys", () => {
  expect(serverFromKey("deadbeefdeadbeef")).toBe("");
  expect(serverFromKey("uplink_nosecret")).toBe("");
  expect(serverFromKey("")).toBe("");
});
