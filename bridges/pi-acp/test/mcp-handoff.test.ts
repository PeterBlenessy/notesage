import { describe, expect, it } from "vitest";
import type { McpServer } from "@agentclientprotocol/sdk";
import { MCP_SERVERS_ENV, mcpEnvFor, mcpKeyFor, stdioHandoffs } from "../src/mcp-handoff";

const stdio = (name: string, env: Array<{ name: string; value: string }> = []): McpServer => ({
  name,
  command: "/usr/bin/mcp-server",
  args: ["--flag"],
  env,
});

describe("mcp-handoff", () => {
  it("serializes stdio servers with env vars flattened", () => {
    const handoffs = stdioHandoffs([stdio("files", [{ name: "API_KEY", value: "resolved-secret" }])]);
    expect(handoffs).toEqual([
      { name: "files", command: "/usr/bin/mcp-server", args: ["--flag"], env: { API_KEY: "resolved-secret" } },
    ]);
  });

  it("skips non-stdio transports (http/sse/acp are agent-native concerns)", () => {
    const http = { type: "http", name: "remote", url: "https://x", headers: [] } as unknown as McpServer;
    expect(stdioHandoffs([http, stdio("local")])).toHaveLength(1);
  });

  it("empty server list → NO env var at all (extension short-circuits)", () => {
    expect(mcpEnvFor([])).toEqual({});
    expect(mcpEnvFor(undefined)).toEqual({});
  });

  it("env payload round-trips through JSON", () => {
    const env = mcpEnvFor([stdio("files")]);
    const parsed = JSON.parse(env[MCP_SERVERS_ENV]!);
    expect(parsed[0]).toMatchObject({ name: "files", command: "/usr/bin/mcp-server" });
  });

  it("mcpKeyFor is stable for equal sets and differs when servers change", () => {
    expect(mcpKeyFor([stdio("a")])).toBe(mcpKeyFor([stdio("a")]));
    expect(mcpKeyFor([stdio("a")])).not.toBe(mcpKeyFor([stdio("b")]));
    expect(mcpKeyFor([])).toBe(mcpKeyFor(undefined));
  });
});
