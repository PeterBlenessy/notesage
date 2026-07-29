// pi Seatbelt spike turn probe: spawn pi --mode rpc (optionally wrapped in
// sandbox-exec), send one prompt, and assert a complete turn arrives from the
// stub within the deadline.
//
// Env:
//   PI_BIN            path to the pi executable (inside its extracted folder)
//   PI_HOME           PI_CODING_AGENT_DIR to use
//   SANDBOX_PROFILE   optional .sb file — when set, wraps pi in sandbox-exec
//   TURN_DEADLINE_MS  assertion deadline (default 30000)
//   EXTRA_ENV_JSON    optional JSON object of extra env vars (proxy scenarios)
//
// Exit codes: 0 = turn completed with expected text; 2 = deadline exceeded
// (hang — the blocked-startup-network failure mode); 3 = wrong output.
import { spawn } from 'node:child_process';

const piBin = process.env.PI_BIN ?? './pi/pi';
const piHome = process.env.PI_HOME ?? process.cwd() + '/pi-home';
const profile = process.env.SANDBOX_PROFILE;
const deadline = Number(process.env.TURN_DEADLINE_MS ?? 30000);
const extraEnv = process.env.EXTRA_ENV_JSON ? JSON.parse(process.env.EXTRA_ENV_JSON) : {};

const piArgs = ['--mode', 'rpc', '--provider', 'local', '--model', 'stub-model', '--no-session'];
const [cmd, args] = profile
  ? ['sandbox-exec', ['-f', profile, piBin, ...piArgs]]
  : [piBin, piArgs];

const started = Date.now();
const child = spawn(cmd, args, {
  env: { ...process.env, ...extraEnv, PI_OFFLINE: '1', PI_CODING_AGENT_DIR: piHome, NO_COLOR: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
let finalText = '';
let settled = false;
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'message_end' && e.message?.role === 'assistant') {
      finalText = (e.message.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    }
    if (e.type === 'agent_settled') {
      settled = true;
      const elapsed = Date.now() - started;
      const ok = finalText.includes('Hello from stub.');
      console.log(`turn settled in ${elapsed}ms; text=${JSON.stringify(finalText)}`);
      child.kill('SIGTERM');
      process.exit(ok ? 0 : 3);
    }
  }
});
child.stderr.on('data', (d) => console.error('pi stderr:', String(d).slice(0, 300)));
child.on('exit', (c, s) => {
  if (!settled) { console.error(`pi exited early (code=${c} sig=${s})`); process.exit(3); }
});

setTimeout(() => child.stdin.write(JSON.stringify({ type: 'prompt', message: 'Say hello.' }) + '\n'), 1500);
setTimeout(() => {
  console.error(`DEADLINE: no agent_settled within ${deadline}ms — hang (blocked startup network?)`);
  child.kill('SIGKILL');
  process.exit(2);
}, deadline);
