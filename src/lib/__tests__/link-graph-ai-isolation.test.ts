import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";

// Regression-lock for task #14 (OKF wiki-navigation, ADR 0002).
//
// The cross-project link graph (links.db, surfaced by the Relations panel and
// the link hover preview) is a HUMAN navigation primitive. It deliberately
// spans the project-isolation boundary — but ADR 0002 draws a bright line: a
// link edge must NEVER auto-widen AI context. An agent may only cross a project
// boundary via the EXISTING tiered permission path (the tool-executor scope
// gate / crossProjectMode), never by following a link edge into the system
// prompt.
//
// This is satisfied today by construction: no AI-context, chat-send, or
// agent-tool module references the link-graph surface. These tests lock that in
// so a future change can't silently wire backlinks / outlinks / wikilink
// resolution into the prompt or expose them as an agent-callable tool — either
// would re-open the cross-project leak the 2026-04-20 red-team pass closed.

const repoRoot = path.resolve(__dirname, "..", "..", "..");

/** Identifiers that only ever belong to the human-facing link-graph surface. */
const LINK_GRAPH_TOKENS = [
  "getBacklinks",
  "getOutlinks",
  "getBrokenLinks",
  "resolveWikilink",
  "useDocumentRelations",
  "link_edges",
  "links.db",
];

/**
 * Modules that build AI context / drive chat sends / define the agent tool
 * surface. NONE of them may reference the link graph — that is the ADR 0002
 * invariant. (Files are guarded with existsSync so a future rename surfaces as
 * a skipped path rather than a false green; the allowlist test below is the
 * belt to this braces.)
 */
const AI_PATH_FILES = [
  "src/hooks/useAIContext.ts",
  "src/lib/ai/context.ts",
  "src/hooks/useDirectApiChat.ts",
  "src/hooks/useAIOperations.ts",
  "src/hooks/useChatContext.ts",
  "src/lib/tool-executor.ts",
];

function read(rel: string): string | null {
  const abs = path.join(repoRoot, rel);
  return existsSync(abs) ? readFileSync(abs, "utf-8") : null;
}

describe("link graph is isolated from AI context (ADR 0002)", () => {
  it("at least one AI-path file exists (guards against a silently-empty sweep)", () => {
    const present = AI_PATH_FILES.filter((f) => read(f) !== null);
    expect(present.length).toBeGreaterThan(0);
  });

  for (const file of AI_PATH_FILES) {
    it(`${file} does not reference the link graph`, () => {
      const src = read(file);
      if (src === null) return; // renamed/removed — covered by the guard above
      for (const token of LINK_GRAPH_TOKENS) {
        expect(
          src.includes(token),
          `${file} must not reference '${token}' — a link edge must never feed AI context (ADR 0002)`,
        ).toBe(false);
      }
    });
  }

  it("the link-graph commands are bound only as a human surface, not an agent tool", () => {
    // The bindings must exist (otherwise the tokens above are vacuous) ...
    const tauri = read("src/lib/tauri.ts");
    expect(tauri).not.toBeNull();
    expect(tauri!.includes("getBacklinks")).toBe(true);

    // ... but the tool executor (the agent-callable surface) must not route any
    // link-graph command.
    const toolExecutor = read("src/lib/tool-executor.ts");
    if (toolExecutor !== null) {
      for (const token of ["get_backlinks", "get_outlinks", "resolve_wikilink"]) {
        expect(
          toolExecutor.includes(token),
          `tool-executor must not expose '${token}' to agents`,
        ).toBe(false);
      }
    }
  });
});
