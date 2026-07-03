import { describe, expect, it } from "vitest";
import { UPLINK_MCP_TOOL_NAMES } from "../src/mcp-tools";

describe("MCP tools", () => {
  it("declares the expected uploader tools", () => {
    expect([...UPLINK_MCP_TOOL_NAMES].sort()).toEqual([
      "create_download_url",
      "create_upload_url",
      "get_file_info",
      "upload_file",
      "upload_from_url",
      "upload_text",
    ]);
  });
});
