import { describe, expect, it } from "vitest";

import { IMPERATIVE_VERBS, isActionCandidate } from "../refinement-detect";

describe("isActionCandidate", () => {
  describe("task-list items (true)", () => {
    it("unchecked checkbox", () => {
      expect(isActionCandidate("- [ ] buy milk")).toBe(true);
    });

    it("checked checkbox", () => {
      expect(isActionCandidate("- [x] buy milk")).toBe(true);
    });

    it("uppercase checked checkbox", () => {
      expect(isActionCandidate("- [X] buy milk")).toBe(true);
    });

    it("asterisk bullet checkbox", () => {
      expect(isActionCandidate("* [ ] read the report")).toBe(true);
    });

    it("ordered checkbox", () => {
      expect(isActionCandidate("1. [ ] do the thing")).toBe(true);
    });

    it("indented checkbox", () => {
      expect(isActionCandidate("    - [ ] nested task")).toBe(true);
    });

    it("checkbox with non-imperative content still counts", () => {
      expect(isActionCandidate("- [ ] the quarterly numbers")).toBe(true);
    });
  });

  describe("imperative bullets (true)", () => {
    it("imperative dash bullet", () => {
      expect(isActionCandidate("- Email the team about Friday")).toBe(true);
    });

    it("imperative asterisk bullet", () => {
      expect(isActionCandidate("* Fix the broken link")).toBe(true);
    });

    it("indented imperative bullet", () => {
      expect(isActionCandidate("  - Schedule a follow-up call")).toBe(true);
    });

    it("bare imperative line (no marker)", () => {
      expect(isActionCandidate("Update the README before release")).toBe(true);
    });

    it("imperative verb case-insensitive", () => {
      expect(isActionCandidate("REVIEW the pull request")).toBe(true);
    });

    it("ordered list imperative", () => {
      expect(isActionCandidate("1. Send the invoice")).toBe(true);
    });
  });

  describe("TODO / FIXME (true)", () => {
    it("TODO with colon", () => {
      expect(isActionCandidate("TODO: refactor this module")).toBe(true);
    });

    it("TODO without colon", () => {
      expect(isActionCandidate("TODO refactor this module")).toBe(true);
    });

    it("FIXME with colon", () => {
      expect(isActionCandidate("FIXME: handle the null case")).toBe(true);
    });

    it("lowercase fixme", () => {
      expect(isActionCandidate("fixme: handle the edge case")).toBe(true);
    });

    it("TODO inside a bullet", () => {
      expect(isActionCandidate("- TODO: wire up the endpoint")).toBe(true);
    });
  });

  describe("structural markdown (false)", () => {
    it("ATX heading", () => {
      expect(isActionCandidate("# Build the future")).toBe(false);
    });

    it("deep ATX heading", () => {
      expect(isActionCandidate("### Send results")).toBe(false);
    });

    it("blockquote", () => {
      expect(isActionCandidate("> Send me the file")).toBe(false);
    });

    it("code fence (backticks)", () => {
      expect(isActionCandidate("```ts")).toBe(false);
    });

    it("code fence (tildes)", () => {
      expect(isActionCandidate("~~~")).toBe(false);
    });

    it("table row", () => {
      expect(isActionCandidate("| send | receive |")).toBe(false);
    });

    it("horizontal rule (dashes)", () => {
      expect(isActionCandidate("---")).toBe(false);
    });

    it("horizontal rule (asterisks)", () => {
      expect(isActionCandidate("***")).toBe(false);
    });

    it("horizontal rule (underscores)", () => {
      expect(isActionCandidate("___")).toBe(false);
    });
  });

  describe("empty / whitespace (false)", () => {
    it("empty string", () => {
      expect(isActionCandidate("")).toBe(false);
    });

    it("whitespace only", () => {
      expect(isActionCandidate("   \t  ")).toBe(false);
    });
  });

  describe("declarative prose (false)", () => {
    it("plain sentence", () => {
      expect(isActionCandidate("The meeting was productive.")).toBe(false);
    });

    it("descriptive line", () => {
      expect(isActionCandidate("We discussed the roadmap at length.")).toBe(false);
    });

    it("prose as a bullet", () => {
      expect(isActionCandidate("- The numbers looked good this quarter.")).toBe(false);
    });
  });

  describe("edge cases — only leading position counts", () => {
    it("imperative verb mid-sentence does not trigger", () => {
      expect(isActionCandidate("She asked me to review the deck.")).toBe(false);
    });

    it("imperative verb later in a bullet does not trigger", () => {
      expect(isActionCandidate("- We should send the report tomorrow.")).toBe(false);
    });

    it("noun that resembles a verb mid-line does not trigger", () => {
      expect(isActionCandidate("Yesterday I had to fix nothing at all.")).toBe(
        false,
      );
    });
  });
});

describe("IMPERATIVE_VERBS", () => {
  it("is a non-empty set of lower-case verbs", () => {
    expect(IMPERATIVE_VERBS.size).toBeGreaterThan(0);
    for (const verb of IMPERATIVE_VERBS) {
      expect(verb).toBe(verb.toLowerCase());
    }
  });

  it("contains the curated core verbs", () => {
    for (const verb of ["add", "fix", "email", "review", "schedule"]) {
      expect(IMPERATIVE_VERBS.has(verb)).toBe(true);
    }
  });
});
