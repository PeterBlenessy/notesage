import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PiProcess } from "../src/pi-process";

// Executable sh wrapper around fake-pi.mjs — spawned exactly like the real pi
// binary (`<bin> --mode rpc`), which node itself would refuse to parse.
const FAKE_PI = join(dirname(fileURLToPath(import.meta.url)), "fake-pi");

import { readFileSync } from "node:fs";

// A pid counts as gone when kill(0) fails OR the process is a zombie —
// a reparented grandchild can linger as an unreaped zombie after group-kill,
// and kill(pid, 0) still succeeds on zombies.
function gone(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
    return state === "Z" || state === "X";
  } catch {
    return true; // /proc entry vanished between the two probes
  }
}

async function waitGone(pid: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (gone(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return gone(pid);
}

async function waitForEvent(
  events: Record<string, unknown>[],
  type: string,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = events.find((e) => e.type === type);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for event ${type}`);
}

interface Launched {
  pi: PiProcess;
  events: Record<string, unknown>[];
  stray: string[];
  settled: Promise<void>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function launch(extraEnv: Record<string, string> = {}, piBin = FAKE_PI): Launched {
  const events: Record<string, unknown>[] = [];
  const stray: string[] = [];
  let resolveSettled!: () => void;
  const settled = new Promise<void>((r) => (resolveSettled = r));
  let resolveExited!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (r) => (resolveExited = r),
  );
  const pi = new PiProcess({
    piBin,
    onEvent: (e) => {
      events.push(e);
      if (e.type === "agent_settled") resolveSettled();
    },
    onNonJson: (l) => stray.push(l),
    onExit: (code, signal) => resolveExited({ code, signal }),
    env: { ...process.env, ...extraEnv },
  });
  return { pi, events, stray, settled, exited };
}

describe("PiProcess", () => {
  it("round-trips a prompt through the fake pi", async () => {
    const { pi, events, settled } = launch();
    expect(pi.send({ type: "prompt", message: "hi" })).toBe(true);
    await settled;
    const types = events.map((e) => e.type);
    expect(types).toContain("agent_start");
    expect(types).toContain("message_update");
    expect(types[types.length - 1]).toBe("agent_settled");
    await pi.stop();
    expect(pi.isAlive).toBe(false);
  });

  it("routes stray stdout lines to onNonJson without dropping events", async () => {
    const { pi, events, stray, settled } = launch({ FAKE_PI_STRAY_STDOUT: "1" });
    pi.send({ type: "prompt", message: "hi" });
    await settled;
    expect(stray).toContain("stray diagnostic line");
    expect(events.map((e) => e.type)).toContain("agent_settled");
    await pi.stop();
  });

  it("stop() kills the whole process group including grandchildren", async () => {
    const { pi, events } = launch({ FAKE_PI_SPAWN_CHILD: "1" });
    const gc = await waitForEvent(events, "fake_pi_grandchild");
    const grandchildPid = gc.pid as number;
    const fakePid = pi.pid!;
    expect(gone(grandchildPid)).toBe(false);
    await pi.stop();
    expect(pi.isAlive).toBe(false);
    expect(await waitGone(fakePid)).toBe(true);
    expect(await waitGone(grandchildPid)).toBe(true);
  });

  it("escalates to SIGKILL when SIGTERM is ignored, and stop() still resolves", async () => {
    const { pi, events, exited } = launch({ FAKE_PI_IGNORE_TERM: "1" });
    await waitForEvent(events, "fake_pi_ready"); // ignore-handler installed
    const started = Date.now();
    await pi.stop(300);
    expect(pi.isAlive).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await exited).signal).toBe("SIGKILL");
  });

  it("a bad binary path surfaces as exit and stop() does not hang", async () => {
    const { pi, exited } = launch({}, "/nonexistent/pi-binary");
    await exited;
    expect(pi.isAlive).toBe(false);
    await pi.stop(); // must resolve immediately
    expect(pi.send({ type: "prompt" })).toBe(false);
  });
});
