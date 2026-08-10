import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "fs";
import path from "path";

// Regression-lock for issue #587 (App Store privacy label — "Data Not
// Collected"). `src/lib/telemetry.ts` is the usage-analytics entry point
// (Stream A, Aptabase `track()`); it must never be reachable from the iOS
// root shell (`src/MobileApp.tsx`, mounted in place of the desktop `App` by
// `main.tsx` via `isIos()` — see docs/features/mobile.md). Root branching —
// not a check inside `App.tsx` — is what keeps the desktop lifecycle hooks
// (AI, ACP, watcher, git, editor, telemetry) from ever being called on iOS.
//
// This walks the REAL static import graph (relative imports + the `@/` alias)
// starting at MobileApp.tsx, rather than checking a fixed file list — an
// indirect import through a new shared hook would otherwise slip past a
// shallow "these known files don't mention telemetry" check.

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const srcRoot = path.join(repoRoot, "src");

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/** Resolve an import specifier to an absolute source file path, or null for
 * external packages / non-JS assets (CSS, images, JSON) we don't traverse. */
function resolveImport(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null; // bare package import — external, not traversed
  }

  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of RESOLVE_EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexPath = path.join(base, `index${ext}`);
    if (existsSync(indexPath)) return indexPath;
  }
  return null; // CSS/asset import, or genuinely missing — not a JS module edge
}

// Matches `from "spec"` (static import/export-from) and bare `import "spec"`,
// plus dynamic `import("spec")`.
const STATIC_IMPORT_RE = /(?:from\s+|^import\s+)["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf-8");
  const specs = new Set<string>();
  for (const re of [STATIC_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    for (const m of src.matchAll(re)) specs.add(m[1]);
  }
  return [...specs];
}

/** BFS the static + dynamic import graph from `entry`. Returns the set of
 * every source file reached (entry included). */
function reachableFrom(entry: string): Set<string> {
  const visited = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const spec of importsOf(file)) {
      const resolved = resolveImport(spec, file);
      if (resolved && !visited.has(resolved)) {
        visited.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return visited;
}

describe("iOS shell never reaches the usage-telemetry module (issue #587)", () => {
  const mobileEntry = path.join(srcRoot, "MobileApp.tsx");
  const telemetryModule = path.join(srcRoot, "lib", "telemetry.ts");
  const desktopEntry = path.join(srcRoot, "App.tsx");

  it("both entry points and the telemetry module exist (guards against a silently-vacuous sweep)", () => {
    expect(existsSync(mobileEntry)).toBe(true);
    expect(existsSync(desktopEntry)).toBe(true);
    expect(existsSync(telemetryModule)).toBe(true);
  });

  it("the traversal itself can detect reachability — the desktop App.tsx DOES reach telemetry.ts", () => {
    // Positive control: if this ever goes false, the BFS/resolver below is
    // broken and the negative assertion for MobileApp is vacuous.
    const reachable = reachableFrom(desktopEntry);
    expect(reachable.has(telemetryModule)).toBe(true);
  });

  it("src/lib/telemetry.ts is unreachable from src/MobileApp.tsx's import graph", () => {
    const reachable = reachableFrom(mobileEntry);
    expect(
      reachable.has(telemetryModule),
      "MobileApp.tsx (directly or transitively) imports src/lib/telemetry.ts — " +
        "the iOS shell must never reach the usage-telemetry entry point.",
    ).toBe(false);
  });
});
