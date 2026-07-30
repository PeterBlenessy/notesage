import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PiAcpAgent } from "../src/acp-server";
import { PiRpc } from "../src/pi-rpc";

const FAKE_PI = join(dirname(fileURLToPath(import.meta.url)), "fake-pi");

let agents: PiAcpAgent[] = [];

function makeAgent(extraEnv: Record<string, string> = {}, onPiEvent?: (e: Record<string, unknown>) => void): PiAcpAgent {
  const agent = new PiAcpAgent({
    spawnPi: (cwd, onEvent) =>
      new PiRpc({ piBin: FAKE_PI, cwd, env: { ...process.env, ...extraEnv }, onEvent }),
    onPiEvent,
  });
  agents.push(agent);
  return agent;
}

afterEach(async () => {
  await Promise.all(agents.map((a) => a.shutdown()));
  agents = [];
});

describe("PiAcpAgent", () => {
  it("initialize negotiates protocol version and advertises loadSession + images", async () => {
    const agent = makeAgent();
    const res = await agent.initialize({ protocolVersion: 1, clientCapabilities: {} });
    expect(res.protocolVersion).toBe(1);
    expect(res.agentCapabilities?.loadSession).toBe(true);
    expect(res.agentCapabilities?.promptCapabilities?.image).toBe(true);
    expect(res.agentInfo?.name).toBe("notesage-pi-acp");
  });

  it("newSession returns pi's session file path as the ACP sessionId", async () => {
    const agent = makeAgent();
    const a = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    expect(a.sessionId).toMatch(/^\/fake\/sessions\/s\d+\.jsonl$/);
    const b = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    expect(b.sessionId).not.toBe(a.sessionId);
  });

  it("prompt completes a turn and returns end_turn", async () => {
    const agent = makeAgent();
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const res = await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "Say hello." }],
    });
    expect(res.stopReason).toBe("end_turn");
  });

  it("loadSession switches pi to the requested session file", async () => {
    const agent = makeAgent();
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.newSession({ cwd: "/tmp", mcpServers: [] }); // move active away
    await expect(
      agent.loadSession({ sessionId, cwd: "/tmp", mcpServers: [] }),
    ).resolves.toEqual({});
    // Prompting the re-loaded session must not need another switch to work.
    const res = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });
    expect(res.stopReason).toBe("end_turn");
  });

  it("unstable_forkSession clones into a NEW session id", async () => {
    const agent = makeAgent();
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const fork = await agent.unstable_forkSession({ sessionId, cwd: "/tmp" });
    expect(fork.sessionId).toMatch(/^\/fake\/sessions\/s\d+\.jsonl$/);
    expect(fork.sessionId).not.toBe(sessionId);
  });

  it("cancel aborts a hanging turn and prompt resolves with cancelled", async () => {
    const agent = makeAgent({ FAKE_PI_HANG_TURN: "1" });
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const turn = agent.prompt({ sessionId, prompt: [{ type: "text", text: "long task" }] });
    await new Promise((r) => setTimeout(r, 300)); // let the turn start
    await agent.cancel({ sessionId });
    const res = await turn;
    expect(res.stopReason).toBe("cancelled");
  });

  it("emits a usage_update after the turn (task #10)", async () => {
    const updates: Record<string, unknown>[] = [];
    const agent = new PiAcpAgent({
      spawnPi: (cwd, onEvent) => new PiRpc({ piBin: FAKE_PI, cwd, env: process.env, onEvent }),
      onSessionUpdate: (_sid, u) => updates.push(u as unknown as Record<string, unknown>),
    });
    agents.push(agent);
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });
    const usage = updates.find((u) => u.sessionUpdate === "usage_update");
    expect(usage).toMatchObject({ used: 1234, size: 8192, cost: { amount: 0, currency: "USD" } });
  });

  it("forwards non-response pi events to onPiEvent (translate hook)", async () => {
    const events: Record<string, unknown>[] = [];
    const agent = makeAgent({}, (e) => events.push(e));
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });
    const types = events.map((e) => e.type);
    expect(types).toContain("message_update");
    expect(types).toContain("agent_settled");
    expect(types).not.toContain("response"); // correlated responses are consumed
  });
});
