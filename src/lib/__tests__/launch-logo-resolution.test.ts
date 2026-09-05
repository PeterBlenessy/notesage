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

describe("launch logo resolution covers the animation's peak", () => {
  const swift = readFileSync(PLUGIN, "utf8");
  const cover = swift.slice(swift.indexOf("private func installLaunchCover"));

  it("has the pixels for the largest size the cover ever draws, at 3x", () => {
    const drawn = [...cover.matchAll(/widthAnchor\.constraint\(equalToConstant: (\d+)\)/g)].map((m) =>
      Number(m[1]),
    )[0];
    const scales = [...swift.matchAll(/CGAffineTransform\(scaleX: ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(drawn).toBeGreaterThan(0);
    expect(scales.length).toBeGreaterThan(0);
    const peakPoints = drawn * Math.max(...scales);
    expect(pngWidth(LOGO_3X)).toBeGreaterThanOrEqual(peakPoints * 3);
  });
});
