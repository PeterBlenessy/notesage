// Agent-level permission flow against the gated fake pi (spike-#3 shapes):
// tool starts → marker'd extension_ui_request → ACP request_permission →
// response resumes/blocks the tool.
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";
import { PiAcpAgent } from "../src/acp-server";
import { PiRpc } from "../src/pi-rpc";
import type { SessionUpdate } from "../src/translate";

const FAKE_PI = join(dirname(fileURLToPath(import.meta.url)), "fake-pi");

let agents: PiAcpAgent[] = [];
afterEach(async () => {
  await Promise.all(agents.map((a) => a.shutdown()));
  agents = [];
});

function makeAgent(
  decide: () => Promise<RequestPermissionResponse>,
): { agent: PiAcpAgent; updates: SessionUpdate[]; asked: number[] } {
  const updates: SessionUpdate[] = [];
  const asked: number[] = [];
  const agent = new PiAcpAgent({
    spawnPi: (cwd, onEvent) =>
      new PiRpc({ piBin: FAKE_PI, cwd, env: { ...process.env, FAKE_PI_GATED_TOOL: "1" }, onEvent }),
    onSessionUpdate: (_sid, u) => updates.push(u),
    requestPermission: (_sid, _ask) => {
      asked.push(Date.now());
      return decide();
    },
  });
  agents.push(agent);
  return { agent, updates, asked };
}

describe("PiAcpAgent permission flow", () => {
  it("allow: tool completes and the turn ends", async () => {
    const { agent, updates, asked } = makeAgent(async () => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const res = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "write it" }] });
    expect(res.stopReason).toBe("end_turn");
    expect(asked).toHaveLength(1);
    const toolUpdates = updates.filter((u) => u.sessionUpdate === "tool_call_update");
    expect(toolUpdates.at(-1)).toMatchObject({ status: "completed" });
  });

  it("deny: tool fails, turn still completes (no wedge)", async () => {
    const { agent, updates } = makeAgent(async () => ({
      outcome: { outcome: "selected", optionId: "reject_once" },
    }));
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const res = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "write it" }] });
    expect(res.stopReason).toBe("end_turn");
    const toolUpdates = updates.filter((u) => u.sessionUpdate === "tool_call_update");
    expect(toolUpdates.at(-1)).toMatchObject({ status: "failed" });
  });

  it("cancel during a pending permission answers the UI first, then aborts (spike-#3 order)", async () => {
    // The decide promise never resolves — the user cancelled the whole turn
    // instead of answering the PermissionCard.
    const { agent } = makeAgent(() => new Promise(() => {}));
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const turn = agent.prompt({ sessionId, prompt: [{ type: "text", text: "write it" }] });
    await new Promise((r) => setTimeout(r, 300)); // let the gate raise its UI request
    await agent.cancel({ sessionId });
    const res = await turn;
    expect(res.stopReason).toBe("cancelled");
  }, 15_000);
});
