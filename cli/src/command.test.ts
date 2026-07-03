import { describe, expect, it } from "bun:test";
import { Command } from "./command";

describe("Command option parsing", () => {
  it("parses long options with value placeholders", async () => {
    let captured: Record<string, string | boolean> = {};
    const cmd = new Command("upload")
      .option("--permanent, -p", "permanent")
      .option("--custom-url <name>", "custom short name")
      .option("--json, -j", "json output")
      .action(async (_args, options) => {
        captured = options;
      });

    await cmd.parse([
      "bun",
      "uplink",
      "upload",
      "file.json",
      "-p",
      "--custom-url",
      "take-care-pr",
      "--json",
    ]);

    expect(captured.permanent).toBe(true);
    expect(captured.customUrl).toBe("take-care-pr");
    expect(captured.json).toBe(true);
  });
});
