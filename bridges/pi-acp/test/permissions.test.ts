import { describe, expect, it, vi } from "vitest";
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";
import { PERMISSION_MARKER, PermissionBroker, type AcpPermissionAsk } from "../src/permissions";

type Responded = { id: string; value?: string; cancelled?: true };

function makeBroker(
  outcome: RequestPermissionResponse | "hang",
  safetyTimeoutMs = 10_000,
): { broker: PermissionBroker; responses: Responded[]; asks: AcpPermissionAsk[] } {
  const responses: Responded[] = [];
  const asks: AcpPermissionAsk[] = [];
  const broker = new PermissionBroker(
    (ask) => {
      asks.push(ask);
      if (outcome === "hang") return new Promise(() => {});
      return Promise.resolve(outcome);
    },
    (r) => responses.push(r),
    safetyTimeoutMs,
  );
  return { broker, responses, asks };
}

const uiReq = (id = "u1") => ({
  type: "extension_ui_request",
  id,
  method: "select",
  title: `${PERMISSION_MARKER}{"toolCallId":"c1","toolName":"write"}`,
  options: ["Allow", "Deny"],
});

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

describe("PermissionBroker", () => {
  it("allow_once → responds Allow", async () => {
    const { broker, responses } = makeBroker({ outcome: { outcome: "selected", optionId: "allow_once" } });
    expect(broker.handle(uiReq())).toBe(true);
    await tick();
    expect(responses).toEqual([{ id: "u1", value: "Allow" }]);
  });

  it("allow_always → responds Allow (persistence is Notesage-side)", async () => {
    const { broker, responses } = makeBroker({ outcome: { outcome: "selected", optionId: "allow_always" } });
    broker.handle(uiReq());
    await tick();
    expect(responses).toEqual([{ id: "u1", value: "Allow" }]);
  });

  it("reject → responds cancelled (gate blocks)", async () => {
    const { broker, responses } = makeBroker({ outcome: { outcome: "selected", optionId: "reject_once" } });
    broker.handle(uiReq());
    await tick();
    expect(responses).toEqual([{ id: "u1", cancelled: true }]);
  });

  it("ACP cancelled outcome (30s auto-deny path) → responds cancelled", async () => {
    const { broker, responses } = makeBroker({ outcome: { outcome: "cancelled" } });
    broker.handle(uiReq());
    await tick();
    expect(responses).toEqual([{ id: "u1", cancelled: true }]);
  });

  it("safety timeout answers a hung ACP client", async () => {
    vi.useFakeTimers();
    try {
      const { broker, responses } = makeBroker("hang", 500);
      broker.handle(uiReq());
      await vi.advanceTimersByTimeAsync(600);
      expect(responses).toEqual([{ id: "u1", cancelled: true }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancelAll answers pending requests exactly once (late outcome ignored)", async () => {
    let resolveAsk!: (r: RequestPermissionResponse) => void;
    const responses: Responded[] = [];
    const broker = new PermissionBroker(
      () => new Promise((r) => (resolveAsk = r)),
      (r) => responses.push(r),
      10_000,
    );
    broker.handle(uiReq());
    expect(broker.pendingCount).toBe(1);
    broker.cancelAll();
    expect(responses).toEqual([{ id: "u1", cancelled: true }]);
    resolveAsk({ outcome: { outcome: "selected", optionId: "allow_once" } }); // too late
    await tick();
    expect(responses).toHaveLength(1);
    expect(broker.pendingCount).toBe(0);
  });

  it("non-Notesage UI requests are answered cancelled immediately", () => {
    const { broker, responses, asks } = makeBroker({ outcome: { outcome: "selected", optionId: "allow_once" } });
    broker.handle({ type: "extension_ui_request", id: "x1", method: "confirm", title: "Some other extension?" });
    expect(responses).toEqual([{ id: "x1", cancelled: true }]);
    expect(asks).toHaveLength(0);
  });

  it("enriches the ACP ask with args from tool_execution_start", async () => {
    const { broker, asks } = makeBroker({ outcome: { outcome: "selected", optionId: "allow_once" } });
    expect(broker.handle({ type: "tool_execution_start", toolCallId: "c1", toolName: "write", args: { path: "/p/x" } })).toBe(false);
    broker.handle(uiReq());
    await tick();
    expect(asks[0]?.toolCall).toMatchObject({ toolCallId: "c1", rawInput: { path: "/p/x" } });
  });
});
