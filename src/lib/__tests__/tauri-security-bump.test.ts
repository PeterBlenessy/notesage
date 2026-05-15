import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Regression-lock for issue #227: Tauri 2.11 security bump (IPC Origin Confusion).
// These tests enforce minimum version constraints so the vulnerable 2.10.x line can
// never silently re-enter the dependency graph.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const cargoLockPath = path.join(repoRoot, 'src-tauri', 'Cargo.lock');
const packageJsonPath = path.join(repoRoot, 'package.json');

/** Extract the resolved version of a crate from Cargo.lock. */
function cargoLockVersion(name: string): string | null {
  const content = readFileSync(cargoLockPath, 'utf8');
  // Cargo.lock has [[package]] blocks; name and version fields are on consecutive
  // lines in declaration order.  We match the block boundary then grab version.
  const re = new RegExp(
    `\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`,
    'm',
  );
  const m = re.exec(content);
  return m ? m[1] : null;
}

/** Parse a semver string into a numeric tuple for comparison. */
function semver(v: string): [number, number, number] {
  const parts = v.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** True when actual >= min. */
function atLeast(actual: string | null, min: string): boolean {
  if (!actual) return false;
  const [ma, mi, mp] = semver(actual);
  const [na, ni, np] = semver(min);
  if (ma !== na) return ma > na;
  if (mi !== ni) return mi > ni;
  return mp >= np;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function packageJsonDep(pkg: string): string | null {
  const pj = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson;
  return pj.dependencies?.[pkg] ?? pj.devDependencies?.[pkg] ?? null;
}

// ── Cargo.lock resolved versions ──────────────────────────────────────────────

describe('Tauri 2.11 security bump — Cargo.lock resolved versions (#227)', () => {
  it('tauri >= 2.11.1 (closes IPC Origin Confusion alert #57)', () => {
    const v = cargoLockVersion('tauri');
    expect(v, `Expected tauri >= 2.11.1 but got ${v}`).not.toBeNull();
    expect(
      atLeast(v, '2.11.1'),
      `tauri ${v} is below the required minimum 2.11.1`,
    ).toBe(true);
  });

  it('tauri-build >= 2.6.1', () => {
    const v = cargoLockVersion('tauri-build');
    expect(atLeast(v, '2.6.1'), `tauri-build ${v} < 2.6.1`).toBe(true);
  });

  it('tauri-plugin-dialog >= 2.7.1', () => {
    const v = cargoLockVersion('tauri-plugin-dialog');
    expect(atLeast(v, '2.7.1'), `tauri-plugin-dialog ${v} < 2.7.1`).toBe(true);
  });

  it('tauri-plugin-fs >= 2.5.1', () => {
    const v = cargoLockVersion('tauri-plugin-fs');
    expect(atLeast(v, '2.5.1'), `tauri-plugin-fs ${v} < 2.5.1`).toBe(true);
  });

  it('tauri-plugin-http >= 2.5.9', () => {
    const v = cargoLockVersion('tauri-plugin-http');
    expect(atLeast(v, '2.5.9'), `tauri-plugin-http ${v} < 2.5.9`).toBe(true);
  });

  it('tauri-plugin-opener >= 2.5.4', () => {
    const v = cargoLockVersion('tauri-plugin-opener');
    expect(atLeast(v, '2.5.4'), `tauri-plugin-opener ${v} < 2.5.4`).toBe(true);
  });
});

// ── package.json constraints ───────────────────────────────────────────────────

describe('Tauri 2.11 security bump — package.json constraints (#227)', () => {
  it('@tauri-apps/api constraint allows >= 2.11.0', () => {
    const constraint = packageJsonDep('@tauri-apps/api');
    expect(constraint, '@tauri-apps/api not found in package.json').not.toBeNull();
    // Strip leading caret/tilde to get the floor version
    const floor = (constraint ?? '').replace(/^[\^~>=]+/, '');
    expect(
      atLeast(floor, '2.11.0'),
      `@tauri-apps/api floor version ${floor} < 2.11.0`,
    ).toBe(true);
  });

  it('@tauri-apps/cli constraint allows >= 2.11.1', () => {
    const constraint = packageJsonDep('@tauri-apps/cli');
    expect(constraint, '@tauri-apps/cli not found in package.json').not.toBeNull();
    const floor = (constraint ?? '').replace(/^[\^~>=]+/, '');
    expect(
      atLeast(floor, '2.11.1'),
      `@tauri-apps/cli floor version ${floor} < 2.11.1`,
    ).toBe(true);
  });
});
