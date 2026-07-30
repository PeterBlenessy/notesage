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
    case 'prompt': {
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
      break;
    default:
      send({ type: 'response', command: cmd.type, success: true, ...(cmd.id ? { id: cmd.id } : {}) });
  }
}

// Keep alive until stdin closes (mirrors pi: exits when the host goes away).
process.stdin.on('end', () => process.exit(0));
