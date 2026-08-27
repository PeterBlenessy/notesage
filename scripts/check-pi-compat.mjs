#!/usr/bin/env node
//
// Does the pi we are pinned to still match the pi extensions we ship?
//
//   node scripts/check-pi-compat.mjs          # human-readable
//   node scripts/check-pi-compat.mjs --json   # machine-readable (CI)
//
// Why this exists
// ---------------
// `notesage-acp-pi` drives pi's pre-1.0 RPC surface, and we ship two TypeScript
// extensions INTO pi's config dir (`bridges/pi-acp/extensions/`). Those
// extensions are loaded by whatever pi is installed and type-checked against
// nothing — they are duck-typed at runtime.
//
// The failure that matters is silent. If pi renames the `tool_call` hook or
// changes the extension entry signature, `permission-gate.ts` stops
// registering, and pi runs writes with NO permission prompt. The agent still
// works; it just no longer asks. Every other signal reads as health — more
// tool calls succeed, nothing errors — so waiting to notice is not a strategy.
//
// `@earendil-works/pi-coding-agent` publishes to npm in lockstep with pi's
// releases AND ships `dist/index.d.ts`. So the extension surface can be checked
// by type-checking our extensions against the published types: no pi binary, no
// model, no runtime. Seconds, and it runs anywhere.
//
// WHAT THIS DOES NOT COVER — read before trusting a green result
// --------------------------------------------------------------
// Mutation-tested when written, against pi 0.84.3:
//
//   - renaming the hook (`pi.on("tool_call")` → a name pi does not know)
//         → CAUGHT (TS2769: no overload matches)
//   - a typo in the handler's RETURN shape (`block` → `blokc`)
//         → NOT CAUGHT
//
// So this is a drift alarm on the extension SIGNATURE surface. It says nothing
// about pi's JSONL RPC method names, its config-file format, or its CLI flags —
// all of which the bridge also depends on. A clean run means "the shape we
// compile against did not move", not "the upgrade is safe".

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS_DIR = join(REPO, 'bridges/pi-acp/extensions');
const EXTENSIONS = ['permission-gate.ts', 'mcp-tools.ts'];
const PKG = '@earendil-works/pi-coding-agent';
const AGENT_MANAGER = join(REPO, 'src-tauri/src/commands/agent_manager.rs');

const asJson = process.argv.includes('--json');

/**
 * The pi version we are pinned to, read from the Rust registry rather than
 * duplicated here. A second copy of the pin is a second thing to forget.
 */
function pinnedPiVersion() {
  const src = readFileSync(AGENT_MANAGER, 'utf8');
  // The `"pi" =>` arm, then its max_version. Anchored to the arm so the
  // adapter's pin (which follows) cannot be picked up by mistake.
  const arm = src.indexOf('"pi" => Some(GithubBinaryAgentConfig {');
  if (arm === -1) throw new Error('Could not find the "pi" arm in agent_manager.rs');
  const armEnd = src.indexOf('}),', arm);
  const match = /max_version:\s*Some\("([^"]+)"\)/.exec(src.slice(arm, armEnd));
  if (!match) throw new Error('The "pi" arm has no max_version pin — has the policy changed?');
  return match[1];
}

function npmLatest(pkg) {
  return execFileSync('npm', ['view', pkg, 'version'], { encoding: 'utf8' }).trim();
}

/**
 * Emit a verdict and stop, without throwing.
 *
 * Everything below can fail for reasons that are not drift: npm unreachable, a
 * renamed package, the Rust registry restructured. Left unhandled, the script
 * threw, CI's `result.json` was empty, `jq` failed on it, and the step went
 * RED — indistinguishable from the alarm firing, and on the noisiest possible
 * trigger (a transient npm outage). A check whose false alarms look like real
 * ones gets muted, which is the one outcome that makes this worse than nothing.
 */
function bail(reason) {
  const out = { pinned: null, latest: null, behind: null, compatible: null, verdict: 'check-failed', errors: reason };
  console.log(asJson ? JSON.stringify(out, null, 2) : `verdict: check-failed\n${reason}`);
  // Exit 0: this is not a compatibility finding, and CI reads the verdict.
  process.exit(0);
}

/** Type-check the shipped extensions against `version` of the pi types. */
function typecheckAgainst(version) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-compat-'));
  try {
    for (const f of EXTENSIONS) copyFileSync(join(EXTENSIONS_DIR, f), join(dir, f));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pi-compat', private: true, type: 'module' }));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true, noEmit: true, module: 'esnext',
        moduleResolution: 'bundler', target: 'es2022', skipLibCheck: true,
      },
      include: ['*.ts'],
    }));
    try {
      execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', `${PKG}@${version}`, 'typescript'],
        { cwd: dir, stdio: 'pipe' });
    } catch (e) {
      // Could not even fetch the types. That is infrastructure, not drift —
      // reporting it as `surface-moved` would file an issue blaming pi for a
      // flaky runner.
      return { infra: `npm install failed for ${PKG}@${version}: ${(e.stderr ?? '').toString().trim().split('\n').slice(-1)[0]}` };
    }
    try {
      execFileSync('npx', ['tsc', '--noEmit'], { cwd: dir, stdio: 'pipe' });
      return { ok: true, output: '' };
    } catch (e) {
      return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let pinned;
let latest;
try {
  pinned = pinnedPiVersion();
} catch (e) {
  bail(`Could not read the pinned pi version: ${e.message}`);
}
try {
  latest = npmLatest(PKG);
} catch (e) {
  bail(`Could not reach npm for ${PKG}: ${(e.stderr ?? e.message ?? '').toString().trim().split('\n').slice(-2).join(' ')}`);
}
const behind = pinned !== latest;

// Only worth checking when there is something new. A clean result against the
// version we already pin proves nothing about an upgrade.
const check = behind ? typecheckAgainst(latest) : { ok: true, output: '(pinned == latest; nothing to check)' };
if (check.infra) bail(check.infra);

const result = {
  pinned,
  latest,
  behind,
  compatible: check.ok,
  // The verdict a human should act on.
  verdict: !behind ? 'up-to-date'
    : check.ok ? 'upgrade-candidate'
    : 'surface-moved',
  errors: check.ok ? '' : check.output.split('\n').slice(0, 25).join('\n'),
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`pinned:  pi ${result.pinned}`);
  console.log(`latest:  pi ${result.latest}`);
  console.log(`verdict: ${result.verdict}`);
  if (result.errors) console.log(`\n${result.errors}`);
}

// Exit code is for humans running it by hand. CI reads --json and decides what
// to file, so a "surface moved" result must NOT fail the workflow step — the
// whole point is that it opens an issue rather than going red and being muted.
process.exit(result.verdict === 'surface-moved' ? 1 : 0);
