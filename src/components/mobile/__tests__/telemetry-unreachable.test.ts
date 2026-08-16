// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * #587 — backs the App Store privacy label "Data Not Collected".
 *
 * The iOS shell must never reach the frontend telemetry entry point
 * (`src/lib/telemetry.ts`). The Rust side is guarded by the Cargo target
 * gate (see telemetry.rs's `telemetry_crates_are_gated_off_the_ios_target`);
 * this test walks the actual static import graph from `MobileApp.tsx` and
 * fails if any transitive import lands on the telemetry module — so a future
 * "just add a track() call" in a shared component turns the build red
 * instead of silently invalidating the privacy label.
 */

const SRC = resolve(__dirname, "../../..");
const FORBIDDEN = resolve(SRC, "lib/telemetry.ts");

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = resolve(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // node_modules — irrelevant to the telemetry module
  if (existsSync(base) && !base.endsWith("/")) {
    // Could be a file without extension or a directory.
    for (const ext of EXTENSIONS) {
      if (existsSync(base + ext)) return base + ext;
    }
    return /\.(ts|tsx|css|json|svg)$/.test(base) ? base : null;
  }
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

function importsOf(file: string): string[] {
  if (!/\.(ts|tsx)$/.test(file)) return [];
  const source = readFileSync(file, "utf8");
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const spec = m[1] ?? m[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

describe("iOS shell telemetry reachability (#587)", () => {
  it("MobileApp's transitive import graph never reaches lib/telemetry.ts", () => {
    const start = resolve(SRC, "MobileApp.tsx");
    expect(existsSync(start)).toBe(true);
    const queue = [start];
    const seen = new Set<string>(queue);
    const via = new Map<string, string>();
    while (queue.length > 0) {
      const file = queue.pop()!;
      for (const spec of importsOf(file)) {
        const target = resolveImport(file, spec);
        if (!target || seen.has(target)) continue;
        seen.add(target);
        via.set(target, file);
        queue.push(target);
      }
    }
    if (seen.has(FORBIDDEN)) {
      // Reconstruct the offending chain for an actionable failure message.
      const chain: string[] = [FORBIDDEN];
      let cur = FORBIDDEN;
      while (via.has(cur)) {
        cur = via.get(cur)!;
        chain.unshift(cur);
      }
      expect.fail(
        `lib/telemetry.ts is reachable from MobileApp.tsx via:\n  ${chain
          .map((f) => f.slice(SRC.length + 1))
          .join("\n  → ")}`,
      );
    }
    // Sanity: the walk actually traversed the shell (not a broken resolver).
    expect(seen.size).toBeGreaterThan(20);
  });
});
