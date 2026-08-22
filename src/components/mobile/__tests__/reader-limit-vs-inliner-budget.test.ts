// The capture pipeline must never be able to save a document the reader will
// then refuse to open.
//
// Two ceilings govern the same artifact, and until 2026-08-22 they were chosen
// independently, in different languages, with nothing relating them:
//
//   ImageInliner.swift  totalEncodedBytes   12 MB   ceiling on inlined images
//   Reader.tsx          MAX_INLINE_TEXT_BYTES 5 MB  ceiling on opening a file
//
// So a captured article was permitted to grow to more than twice what the
// reader would open. It duly happened — a 48-image news article filled the
// inliner budget and became unopenable from the Inbox, with no way for the
// user to recover the thing they had just saved.
//
// Neither number is wrong in isolation; the relationship between them was
// never expressed anywhere, so nothing objected. This test expresses it. It
// reads both constants from source rather than importing them, because one of
// them is Swift and unreachable from vitest — the same approach
// `tauri-capability-surface.test.ts` takes to lock invariants that live in
// config files.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../../../..");
const INLINER = resolve(
  ROOT,
  "src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/ImageInliner.swift",
);
const READER = resolve(ROOT, "src/components/mobile/Reader.tsx");

/** Evaluate a `12 * 1024 * 1024`-style literal without eval(). */
function productOfLiteral(expr: string): number {
  return expr
    .split("*")
    .map((part) => Number(part.trim().replace(/_/g, "")))
    .reduce((a, b) => a * b, 1);
}

function readConstant(file: string, pattern: RegExp, label: string): number {
  const match = readFileSync(file, "utf8").match(pattern);
  if (!match) {
    // A rename that silently skips the check would defeat the point — the
    // whole failure being locked here is "nobody noticed the relationship".
    throw new Error(`Could not find ${label} in ${file}. If it was renamed, update this test.`);
  }
  const value = productOfLiteral(match[1]);
  expect(Number.isFinite(value), `${label} did not parse as a number`).toBe(true);
  return value;
}

describe("reader limit vs inliner budget", () => {
  const inlinerBudget = readConstant(
    INLINER,
    /var\s+totalEncodedBytes:\s*Int\s*=\s*([0-9_ *]+)/,
    "totalEncodedBytes",
  );
  const readerLimit = readConstant(
    READER,
    /const\s+MAX_INLINE_TEXT_BYTES\s*=\s*([0-9_ *]+)/,
    "MAX_INLINE_TEXT_BYTES",
  );

  it("lets the reader open anything the inliner is allowed to produce", () => {
    expect(readerLimit).toBeGreaterThan(inlinerBudget);
  });

  it("keeps a margin, so the document around the images fits too", () => {
    // The inlined images are not the whole file: there is the article markup,
    // the find/link agents injected at open time, and base64's 4/3 inflation
    // already counted inside the inliner's own budget. A reader limit merely
    // *above* the image budget would leave a captured article sitting right at
    // the edge, which is how this broke the first time. 2x is the smallest
    // margin that is obviously not borderline.
    expect(readerLimit).toBeGreaterThanOrEqual(inlinerBudget * 2);
  });

  it("still refuses the multi-hundred-MB file the guard exists for (#616)", () => {
    // The Apple Health export that prompted the guard. Raising the reader
    // limit must not quietly turn the guard off: at 250 MB the IPC JSON parse
    // measures ~3.5s on an M3 and considerably worse on a phone, which is the
    // frozen spinner and dead back button from the original report.
    expect(readerLimit).toBeLessThan(200 * 1024 * 1024);
  });
});
