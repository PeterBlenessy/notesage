/**
 * Regression-lock for the release workflow's prerelease-detection logic.
 *
 * HARD GUARANTEE: alpha / beta / rc tags MUST be published with
 * `prerelease: true` so GitHub's `releases/latest` resolver skips them
 * and stable-channel users never get auto-upgraded to a prerelease.
 *
 * Before this lock was added, `release.yml` had `prerelease: false`
 * hardcoded. v0.44.0-alpha.0 and v0.44.0-alpha.1 shipped as non-prerelease
 * releases — a stable v0.43.0 user got auto-updated to alpha.1 by the
 * in-app Tauri updater. The user named this "unthinkable".
 *
 * This test asserts that:
 *
 *   1. `release.yml`'s `create-release` step computes `prerelease` from
 *      the tag name (not a hardcoded boolean).
 *   2. The detection regex covers `-alpha`, `-beta`, `-rc` suffixes
 *      (the SemVer prerelease grammar Notesage uses today).
 *
 * Companion: in-app guard in `src/hooks/useAutoUpdate.ts` rejects
 * prerelease manifests on stable channel even if the server-side flag
 * is wrong. Defense in depth.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const RELEASE_YML = readFileSync(
  resolve(__dirname, "../../../.github/workflows/release.yml"),
  "utf-8",
);

describe("release.yml — prerelease auto-detection (HARD GUARANTEE)", () => {
  it("computes prerelease from the tag, not a hardcoded boolean", () => {
    // The previous bug was `prerelease: false` hardcoded — this regex
    // ensures the value is derived from a variable, not a literal.
    // We strip `//` comments first so the comment that explains the bug
    // doesn't trigger the anti-pattern match.
    const createReleaseBlock = stripJsComments(
      extractCreateReleaseBlock(RELEASE_YML),
    );

    // Anti-pattern: `prerelease: false` or `prerelease: true` literal.
    expect(createReleaseBlock).not.toMatch(/prerelease:\s*(true|false)\b/);

    // Required: prerelease must be assigned an identifier or expression.
    expect(createReleaseBlock).toMatch(/prerelease:\s*[a-zA-Z_$]/);
  });

  it("detects -alpha, -beta, -rc suffixes via a regex on the tag", () => {
    // The detection logic must cover all three SemVer prerelease tags
    // Notesage uses. Match the regex pattern in the workflow script.
    const detectionMatch = RELEASE_YML.match(
      /-\(alpha\|beta\|rc\)|\/-\(alpha\|beta\|rc\)/,
    );
    expect(
      detectionMatch,
      "release.yml must contain a regex matching -(alpha|beta|rc) for prerelease detection",
    ).not.toBeNull();
  });

  it("references the tag variable when computing prerelease", () => {
    // Sanity: the detection runs against `tag` (the resolved tag name),
    // not against a literal or some other input.
    const createReleaseBlock = extractCreateReleaseBlock(RELEASE_YML);
    expect(createReleaseBlock).toMatch(/const\s+tag\s*=/);
    expect(createReleaseBlock).toMatch(/test\s*\(\s*tag\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripJsComments(src: string): string {
  // Strip `// ...` line comments AND `/* ... */` block comments from the
  // embedded JS script so the rationale comments inside don't false-match
  // the anti-pattern regex (which is checking the actual code shape).
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractCreateReleaseBlock(yml: string): string {
  // Pull the `Create Release` step's script body. We don't full-parse YAML —
  // a substring grab is sufficient because the keys/values we check are
  // textually distinctive. Slice ends at the next `- name:` boundary so we
  // don't pick up state from sibling steps (like the `update-latest-alpha`
  // job which legitimately uses `--prerelease` on a different gh command).
  const start = yml.indexOf("- name: Create Release");
  if (start === -1) {
    throw new Error(
      "release.yml: 'Create Release' step not found — workflow structure changed",
    );
  }
  const rest = yml.slice(start);
  const nextStep = rest.indexOf("- name: ", 1); // skip the matched start
  return nextStep === -1 ? rest : rest.slice(0, nextStep);
}
