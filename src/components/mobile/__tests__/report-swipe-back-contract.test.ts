// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { COMMIT_DISTANCE, COMMIT_VELOCITY, EDGE_WIDTH } from "../useEdgeSwipeBack";

/**
 * Swipe-back on a saved article is a NATIVE gesture, and this locks the two
 * halves of it together.
 *
 * A report is presented in its own `WKWebView` above the app's (ADR 0010), so
 * the reader's `useEdgeSwipeBack` strip — which lives in the app's web view —
 * is never under the finger. Instrumenting it on a presented report logged not
 * one `pointerdown`: the gesture was not failing, it was never arriving (Peter,
 * build 54: swipe right does not close an article). `ReportWebView.swift` puts
 * its own transparent strip over the report and reports the finished gesture
 * back as a `notesage:report` event.
 *
 * Nothing else can catch a break here. There is no XCTest target for the plugin
 * (issue #933), the two sides are written in different languages, and a rename
 * on either side fails silently — the reader would simply stop closing, exactly
 * the symptom that started this. So the contract is asserted from the sources:
 * the event name both sides speak, and the numbers that make the gesture feel
 * the same whichever kind of document is open.
 */

const SWIFT = readFileSync(
  resolve(
    __dirname,
    "../../../../src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/ReportWebView.swift",
  ),
  "utf8",
);
const READER = readFileSync(resolve(__dirname, "../Reader.tsx"), "utf8");

/** `private static let <name>: CGFloat = <number>` */
function swiftConstant(name: string): number {
  const match = SWIFT.match(new RegExp(`let ${name}: CGFloat = ([0-9.]+)`));
  if (!match) throw new Error(`ReportWebView.swift no longer declares ${name}`);
  return Number(match[1]);
}

describe("report swipe-back — the native half and the reader half agree", () => {
  it("speaks the same event name on both sides", () => {
    expect(SWIFT).toContain('dispatch("back"');
    expect(READER).toContain('detail?.type === "back"');
  });

  it("leaves the decision to the reader rather than dismissing itself", () => {
    // The app owns what "back" means — an unsaved draft to persist, a folder to
    // return to. A report that took itself down would skip all of it.
    const handler = SWIFT.slice(SWIFT.indexOf("@objc private func handleEdgeBack"));
    const body = handler.slice(0, handler.indexOf("\n  }\n"));
    expect(body).toContain("emitBack()");
    expect(body).not.toContain("dismiss()");
  });

  it("uses the same commit thresholds as the web strip", () => {
    // One gesture, one size: a reader should not need a different-sized swipe
    // depending on whether the document is a note or a captured article.
    expect(swiftConstant("edgeStripWidth")).toBe(EDGE_WIDTH);
    expect(swiftConstant("backCommitDistance")).toBe(COMMIT_DISTANCE);
    // The web side is px per MILLISECOND; UIKit velocity is points per second.
    expect(swiftConstant("backCommitVelocity")).toBe(COMMIT_VELOCITY * 1000);
  });
});
