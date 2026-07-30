#!/usr/bin/env node
// Scripted stand-in for `pi --mode rpc` (task #6 test harness).
//
// Replays the event shapes recorded live from pi v0.80.6 (spikes #1/#3).
// Behavior knobs via env:
//   FAKE_PI_SPAWN_CHILD=1  spawn a long-lived grandchild (orphan-kill test)
//   FAKE_PI_IGNORE_TERM=1  ignore SIGTERM (forces the SIGKILL path)
//   FAKE_PI_STRAY_STDOUT=1 print a non-JSON line before responding
import { spawn } from 'node:child_process';

if (process.env.FAKE_PI_IGNORE_TERM === '1') process.on('SIGTERM', () => {});

let grandchild;
if (process.env.FAKE_PI_SPAWN_CHILD === '1') {
  grandchild = spawn('sleep', ['300'], { stdio: 'ignore' });
  // Report the grandchild pid so the test can probe it after teardown.
  console.log(JSON.stringify({ type: 'fake_pi_grandchild', pid: grandchild.pid }));
}

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
// Signal readiness AFTER handlers/children are set up, so tests never race
// the SIGTERM-ignore installation or the grandchild spawn.
send({ type: 'fake_pi_ready' });
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let cmd;
    try { cmd = JSON.parse(line); } catch { continue; }
    handle(cmd);
  }
});

function handle(cmd) {
  if (process.env.FAKE_PI_STRAY_STDOUT === '1') console.log('stray diagnostic line');
  switch (cmd.type) {
    case 'extension_ui_response': {
      if (pendingGate && cmd.id === pendingGate.uiId) {
        const allowed = cmd.value === 'Allow';
        const gate = pendingGate;
        pendingGate = null;
        if (allowed) {
          send({ type: 'tool_execution_end', toolCallId: gate.toolCallId, toolName: 'write', result: { content: [{ type: 'text', text: 'wrote file' }], details: {} }, isError: false });
        } else {
          send({ type: 'tool_execution_end', toolCallId: gate.toolCallId, toolName: 'write', result: { content: [{ type: 'text', text: 'Tool call denied' }], details: {} }, isError: true });
        }
        send({ type: 'agent_end', messages: [] });
        send({ type: 'agent_settled' });
      }
      break;
    }
    case 'prompt': {
      if (process.env.FAKE_PI_GATED_TOOL === '1') {
        // Mirrors spike #3: tool starts, the gate extension raises a select
        // with the Notesage permission marker, and the turn only proceeds
        // once the host answers the extension_ui_response.
        send({ type: 'response', command: 'prompt', success: true, ...(cmd.id ? { id: cmd.id } : {}) });
        send({ type: 'agent_start' });
        const toolCallId = 'call_gated_1';
        const uiId = 'ui-req-1';
        pendingGate = { toolCallId, uiId };
        send({ type: 'tool_execution_start', toolCallId, toolName: 'write', args: { path: '/p/x.txt', content: 'hi' } });
        send({
          type: 'extension_ui_request', id: uiId, method: 'select',
          title: `__NOTESAGE_PERMISSION__${JSON.stringify({ toolCallId, toolName: 'write' })}`,
          options: ['Allow', 'Deny'],
        });
        break;
      }
      if (process.env.FAKE_PI_HANG_TURN === '1') {
        // Turn that never settles on its own — abort resolves it (models a
        // long-running real turn for the cancel test).
        send({ type: 'response', command: 'prompt', success: true, ...(cmd.id ? { id: cmd.id } : {}) });
        send({ type: 'agent_start' });
        hangingTurn = true;
        break;
      }
      send({ type: 'response', command: 'prompt', success: true, ...(cmd.id ? { id: cmd.id } : {}) });
      send({ type: 'agent_start' });
      send({ type: 'turn_start' });
      send({ type: 'message_start', message: { role: 'assistant', content: [] } });
      send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello ' } });
      send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'from fake pi.' } });
      send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello from fake pi.' }] } });
      send({ type: 'turn_end' });
      send({ type: 'agent_end', messages: [] });
      send({ type: 'agent_settled' });
      break;
    }
    case 'abort':
      send({ type: 'response', command: 'abort', success: true, ...(cmd.id ? { id: cmd.id } : {}) });
      if (hangingTurn) {
        hangingTurn = false;
        send({ type: 'agent_end', messages: [] });
        send({ type: 'agent_settled' });
      }
      break;
    case 'new_session':
      sessionCounter++;
      currentSession = `/fake/sessions/s${sessionCounter}.jsonl`;
      send({ type: 'response', command: 'new_session', success: true, data: { cancelled: false }, ...(cmd.id ? { id: cmd.id } : {}) });
      break;
    case 'get_session_stats':
      send({
        type: 'response', command: 'get_session_stats', success: true,
        data: {
          sessionFile: currentSession, sessionId: `id-${sessionCounter}`, userMessages: 0, assistantMessages: 0,
          tokens: { input: 500, output: 100, cacheRead: 0, cacheWrite: 0, total: 600 },
          cost: 0,
          contextUsage: { tokens: 1234, contextWindow: 8192, percent: 15 },
        },
        ...(cmd.id ? { id: cmd.id } : {}),
      });
      break;
    case 'switch_session':
      if (typeof cmd.sessionPath === 'string') {
        currentSession = cmd.sessionPath;
        send({ type: 'response', command: 'switch_session', success: true, data: { cancelled: false }, ...(cmd.id ? { id: cmd.id } : {}) });
      } else {
        send({ type: 'response', command: 'switch_session', success: false, error: 'missing sessionPath', ...(cmd.id ? { id: cmd.id } : {}) });
      }
      break;
    case 'clone':
      sessionCounter++;
      currentSession = `/fake/sessions/s${sessionCounter}.jsonl`;
      send({ type: 'response', command: 'clone', success: true, data: { cancelled: false }, ...(cmd.id ? { id: cmd.id } : {}) });
      break;
    default:
      send({ type: 'response', command: cmd.type, success: true, ...(cmd.id ? { id: cmd.id } : {}) });
  }
}

let sessionCounter = 0;
let currentSession = '/fake/sessions/s0.jsonl';
let hangingTurn = false;
let pendingGate = null;

// Keep alive until stdin closes (mirrors pi: exits when the host goes away).
process.stdin.on('end', () => process.exit(0));
