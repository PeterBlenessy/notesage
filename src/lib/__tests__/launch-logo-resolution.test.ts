import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The launch cover grows the logo while the app loads, and a transform does
 * not re-render artwork — it samples the pixels the image already has. So the
 * imageset has to carry the PEAK size, not the drawn size.
 *
 * It did not: a 60pt base (180px at 3x) stretched across 276pt of screen is a
 * 4.6x magnification, and it looked like one (Peter, device, build 50).
 *
 * This computes the requirement from the Swift rather than restating it, so
 * raising the animation's scale without raising the artwork fails here
 * instead of on a phone.
 *
 * It reads the numbers from the two functions that own the cover's animation
 * and NOWHERE else (#928). Scanning the whole plugin meant any unrelated
 * `CGAffineTransform(scaleX:` — a press animation, a sheet transition —
 * joined the set the peak is taken from: a larger scale elsewhere would fail
 * this on a launch logo that is perfectly adequate, and either way the test
 * would have stopped measuring what its name claims.
 */
const PLUGIN = resolve(
  __dirname,
  "../../../src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/NotesageIosPlugin.swift",
);
const LOGO_3X = resolve(__dirname, "../../../src-tauri/ios/LaunchAssets/LaunchLogo.imageset/logo@3x.png");

/** Width from the PNG's IHDR chunk. */
function pngWidth(path: string): number {
  return readFileSync(path).readUInt32BE(16);
}

/** Blank out line comments and string literals so their braces cannot throw
 *  off the body scan below. Replaced with spaces rather than removed, to keep
 *  every offset where it was. */
function withoutCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => " ".repeat(m.length));
}

/**
 * The body of a Swift function, by brace matching from its signature. Throws
 * rather than returning "" if the function is gone — a renamed or extracted
 * function must fail loudly here, not silently match nothing and pass.
 */
function funcBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`launch-cover function not found: ${signature}`);
  const scannable = withoutCommentsAndStrings(src);
  const open = scannable.indexOf("{", start + signature.length);
  if (open < 0) throw new Error(`no body for: ${signature}`);
  let depth = 0;
  for (let i = open; i < scannable.length; i++) {
    if (scannable[i] === "{") depth++;
    else if (scannable[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced body for: ${signature}`);
}

describe("launch logo resolution covers the animation's peak", () => {
  const swift = readFileSync(PLUGIN, "utf8");
  // The cover's animation spans BOTH functions: it grows to 2x while loading
  // and keeps growing to 2.3x as it fades out. Reading only the installer
  // would quietly lower the bar to the smaller of the two.
  const install = funcBody(swift, "private func installLaunchCover");
  const remove = funcBody(swift, "func removeLaunchCover");

  it("has the pixels for the largest size the cover ever draws, at 3x", () => {
    const drawn = [...install.matchAll(/widthAnchor\.constraint\(equalToConstant: (\d+)\)/g)].map((m) =>
      Number(m[1]),
    )[0];
    const scales = [install, remove].flatMap((body) =>
      [...body.matchAll(/CGAffineTransform\(scaleX: ([\d.]+)/g)].map((m) => Number(m[1])),
    );
    expect(drawn).toBeGreaterThan(0);
    // An extracted or renamed animation must fail here rather than leave the
    // peak at 1x by matching nothing.
    expect(scales.length).toBeGreaterThan(0);
    const peakPoints = drawn * Math.max(...scales);
    expect(pngWidth(LOGO_3X)).toBeGreaterThanOrEqual(peakPoints * 3);
  });

  it("takes its scales only from the cover, not from the rest of the plugin", () => {
    const all = [...swift.matchAll(/CGAffineTransform\(scaleX: ([\d.]+)/g)].length;
    const mine = [install, remove].flatMap((body) => [
      ...body.matchAll(/CGAffineTransform\(scaleX: ([\d.]+)/g),
    ]).length;
    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThanOrEqual(all);
    // Each body ends where the function does — anything after the closing
    // brace belongs to some other animation.
    expect(install.trimEnd().endsWith("}")).toBe(true);
    expect(remove.trimEnd().endsWith("}")).toBe(true);
  });
});
