// Local agentic evaluation — opt-in.
//
// Everything else in the local-AI stack is tuned against reasoning: context
// sizing, KV quantization, tool budgets, compaction. None of it is falsifiable
// without measuring whether a model actually completes agentic work, and
// "supports_tool_calling" is a binary flag that says nothing about competence.
//
// Skipped unless pointed at a real model, because it needs multi-GB weights and
// takes minutes:
//
//   EVAL_MODEL=~/.notesage/models/llm/<model>.gguf pnpm vitest run src/eval
//
// Optional:
//   EVAL_BINARY=<path to llama-server>   (defaults to the bundled sidecar)
//   EVAL_CONTEXT=<tokens>                (default 8192)
//   EVAL_PORT=<port>                     (default 8177)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { EVAL_TASKS } from './tasks';
import { startEvalServer, runTask, formatReport, type ServerHandle, type TaskResult } from './harness';

function expandHome(p: string): string {
  return p.startsWith('~') ? resolve(homedir(), p.slice(1).replace(/^\//, '')) : resolve(p);
}

const MODEL = process.env.EVAL_MODEL ? expandHome(process.env.EVAL_MODEL) : null;
const BINARY = expandHome(
  process.env.EVAL_BINARY ??
    'src-tauri/binaries/llama-server-aarch64-apple-darwin',
);
const CONTEXT = Number(process.env.EVAL_CONTEXT ?? 8192);
const PORT = Number(process.env.EVAL_PORT ?? 8177);

const enabled = Boolean(MODEL && existsSync(MODEL) && existsSync(BINARY));

describe.skipIf(!enabled)('local agentic eval', () => {
  let server: ServerHandle;
  const results: TaskResult[] = [];

  beforeAll(async () => {
    server = await startEvalServer({
      binary: BINARY,
      modelPath: MODEL!,
      port: PORT,
      contextLength: CONTEXT,
    });
  }, 300_000);

  afterAll(async () => {
    await server?.stop();
    if (results.length > 0) {
      // The table is the artifact — the per-test assertions only mark which
      // rows failed. Printed even on failure so a red run is still a report.
      console.log(formatReport(MODEL?.split('/').pop() ?? 'model', results));
    }
  });

  // One test per task so a failure names the specific competence that is
  // missing, rather than collapsing to "the model scored 4/6".
  for (const task of EVAL_TASKS) {
    it(
      `${task.id} — ${task.probes}`,
      async () => {
        const result = await runTask(server.port, task);
        results.push(result);
        expect(result.error).toBeUndefined();
        expect(result.passed).toBe(true);
      },
      120_000,
    );
  }
});

describe('local agentic eval — task set', () => {
  // These run always: a broken task set would silently invalidate every
  // measurement taken with it.
  it('every task has a unique id', () => {
    const ids = EVAL_TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every task offers at least one tool and says what it probes', () => {
    for (const task of EVAL_TASKS) {
      expect(task.tools.length).toBeGreaterThan(0);
      expect(task.probes.length).toBeGreaterThan(0);
    }
  });

  it('no check passes on an empty trajectory', () => {
    // A task that scores a model which called nothing is not measuring agentic
    // behaviour — it is measuring nothing.
    for (const task of EVAL_TASKS) {
      if (task.id === 'no-hallucinated-tool') continue; // vacuously true by design
      expect(task.check([])).toBe(false);
    }
  });

  it('the hallucination task deliberately passes on restraint', () => {
    // Documents the one intentional exception above: calling nothing is a
    // correct response to being asked for a capability that was not offered.
    const t = EVAL_TASKS.find((x) => x.id === 'no-hallucinated-tool')!;
    expect(t.check([])).toBe(true);
    expect(t.check([{ name: 'delete_file', arguments: {} }])).toBe(false);
  });
});

describe('local agentic eval — report honesty', () => {
  it('flags a pass earned by calling nothing', async () => {
    // A model that never calls a tool collects the restraint task for free.
    // The headline score would then overstate it.
    const { formatReport } = await import('./harness');
    const report = formatReport('silent-model', [
      { id: 'no-hallucinated-tool', probes: 'restraint', passed: true, calls: [], elapsedMs: 10 },
    ]);
    expect(report).toContain('[no tool calls]');
    expect(report).toMatch(/not usable as an agent/i);
  });

  it('does not add that caveat when the model actually acted', async () => {
    const { formatReport } = await import('./harness');
    const report = formatReport('working-model', [
      { id: 'single-tool', probes: 'calls a tool', passed: true, calls: [{ name: 'read_file', arguments: {} }], elapsedMs: 10 },
    ]);
    expect(report).not.toContain('[no tool calls]');
    expect(report).not.toMatch(/not usable as an agent/i);
  });
});
