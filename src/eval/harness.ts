// Runner for the local agentic evaluation.
//
// Drives a real llama-server over its OpenAI-compatible endpoint — the same
// surface the app uses — so a result here means the model behaves that way in
// Notesage, not in an idealised test rig.
//
// Opt-in by design: it needs a multi-GB model and takes minutes. Nothing here
// runs in the normal suite.

import { spawn, type ChildProcess } from 'node:child_process';
import type { EvalTask, ToolCallObservation } from './tasks';

export interface ServerHandle {
  port: number;
  stop: () => Promise<void>;
}

/** Wait for the server's /health to answer, or give up. */
async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Start llama-server with the same flags the app uses for a tool-calling model.
 *
 * `--jinja` is what makes tool calls grammar-constrained, so omitting it here
 * would measure a configuration the app never ships.
 */
export async function startEvalServer(opts: {
  binary: string;
  modelPath: string;
  port: number;
  contextLength: number;
  startupTimeoutMs?: number;
}): Promise<ServerHandle> {
  const child: ChildProcess = spawn(
    opts.binary,
    [
      '--model', opts.modelPath,
      '--port', String(opts.port),
      '--ctx-size', String(opts.contextLength),
      '--n-gpu-layers', '-1',
      '--host', '127.0.0.1',
      '--jinja',
      '--cache-type-k', 'q8_0',
      '--cache-type-v', 'q8_0',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => {
    // Keep only the tail — enough to explain a failed start without holding the
    // whole run in memory.
    stderr = (stderr + d.toString()).slice(-4000);
  });

  const stop = async () => {
    if (!child.killed) child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    if (!child.killed) child.kill('SIGKILL');
  };

  const healthy = await waitForHealth(opts.port, opts.startupTimeoutMs ?? 180_000);
  if (!healthy) {
    await stop();
    throw new Error(`llama-server did not become healthy.\n--- stderr tail ---\n${stderr}`);
  }

  return { port: opts.port, stop };
}

interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: Array<{ id?: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

function observeCalls(message: ChatMessage | undefined): ToolCallObservation[] {
  if (!message?.tool_calls) return [];
  return message.tool_calls.map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || '{}');
    } catch {
      // A call whose arguments do not parse is a real failure mode, not a
      // harness problem — record it as an empty object so the task's check
      // fails rather than the run erroring out.
    }
    return { name: tc.function.name, arguments: args };
  });
}

export interface TaskResult {
  id: string;
  probes: string;
  passed: boolean;
  calls: ToolCallObservation[];
  elapsedMs: number;
  error?: string;
}

/**
 * Run one task, including a second turn when the task supplies a tool result.
 *
 * Observations accumulate across turns so multi-step tasks can be scored on the
 * whole trajectory rather than a single response.
 */
export async function runTask(
  port: number,
  task: EvalTask,
  maxTokens = 1200,
): Promise<TaskResult> {
  const started = Date.now();
  const messages: ChatMessage[] = [{ role: 'user', content: task.prompt }];
  const observed: ToolCallObservation[] = [];

  const send = async (): Promise<ChatMessage | undefined> => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, tools: task.tools, max_tokens: maxTokens }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message: ChatMessage }> };
    return body.choices?.[0]?.message;
  };

  try {
    const first = await send();
    observed.push(...observeCalls(first));

    // Second turn only when the task defines one AND the model actually called
    // something to respond to.
    if (task.followUpResult && first?.tool_calls?.length) {
      messages.push({
        role: 'assistant',
        content: first.content ?? '',
        tool_calls: first.tool_calls,
      });
      messages.push({
        role: 'tool',
        content: task.followUpResult,
        tool_call_id: first.tool_calls[0].id ?? 'call_0',
      });
      observed.push(...observeCalls(await send()));
    }

    return {
      id: task.id,
      probes: task.probes,
      passed: task.check(observed),
      calls: observed,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      id: task.id,
      probes: task.probes,
      passed: false,
      calls: observed,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Render results as a table, so two models can be compared at a glance. */
export function formatReport(modelLabel: string, results: TaskResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const lines = [
    '',
    `Local agentic eval — ${modelLabel}`,
    `${passed}/${results.length} passed`,
    '',
    'result  task                  ms     probes',
    '------  --------------------  -----  ----------------------------------------',
  ];
  for (const r of results) {
    // A pass earned by calling nothing is not competence — the restraint task
    // is satisfied by silence, so a model that never calls a tool collects it
    // for free. Marking it keeps the headline score from reading as ability.
    const vacuous = r.passed && r.calls.length === 0;
    lines.push(
      `${r.passed ? '  PASS' : '  FAIL'}  ${r.id.padEnd(20)}  ${String(r.elapsedMs).padStart(5)}  ${r.probes}${vacuous ? '  [no tool calls]' : ''}`,
    );
    if (!r.passed) {
      const detail = r.error
        ? `error: ${r.error}`
        : `calls: ${JSON.stringify(r.calls)}`.slice(0, 160);
      lines.push(`        ${detail}`);
    }
  }

  const silent = results.filter((r) => r.calls.length === 0).length;
  if (silent === results.length) {
    lines.push('');
    lines.push('  NOTE: this model emitted no tool calls at all — it is not usable as an agent,');
    lines.push('        whatever the headline score suggests.');
  }
  return lines.join('\n');
}
