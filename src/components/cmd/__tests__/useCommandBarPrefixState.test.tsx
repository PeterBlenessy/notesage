// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef, useState } from "react";
import {
  useCommandBarPrefixState,
  type CommandBarPrefixState,
} from "@/components/cmd/useCommandBarPrefixState";

/**
 * Tests for `useCommandBarPrefixState` — the FloatingCommandBar's prefix/verb
 * detection state machine (PRD `2026-04-28-cmd-bar-verb-prefixes`). Exercises
 * the branch logic in `recomputePrefix` (prefix wins over verb, Esc-dismissal
 * suppression for both namespaces), the drilldown/active-option teardown
 * effect, and the token-replacement helpers `handlePickSkill` / `handlePickVerb`.
 */

interface Harness {
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  prefix: CommandBarPrefixState;
}

function useHarness(): Harness {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const prefix = useCommandBarPrefixState({
    inputValue,
    setInputValue,
    inputRef,
  });
  return { inputValue, setInputValue, prefix };
}

function renderHarness() {
  return renderHook(() => useHarness());
}

describe("useCommandBarPrefixState", () => {
  beforeEach(() => {
    // jsdom animation frame is synchronous-enough; nothing to reset globally.
  });

  it("starts with no active prefix or verb", () => {
    const { result } = renderHarness();
    expect(result.current.prefix.activePrefix).toBeNull();
    expect(result.current.prefix.activeVerb).toBeNull();
    expect(result.current.prefix.activePrefixRef.current).toBeNull();
  });

  it("detects a noun prefix via recomputePrefix and mirrors it onto the ref", () => {
    const { result } = renderHarness();
    act(() => {
      result.current.setInputValue("#ta");
    });
    act(() => {
      result.current.prefix.recomputePrefix("#ta", 3);
    });
    const active = result.current.prefix.activePrefix;
    expect(active).not.toBeNull();
    expect(active?.mode.prefix).toBe("#");
    expect(active?.mode.id).toBe("tag");
    expect(active?.filter).toBe("ta");
    // Render-phase mirror kept in sync.
    expect(result.current.prefix.activePrefixRef.current).toBe(active);
    // Noun prefix wins → verb forced null.
    expect(result.current.prefix.activeVerb).toBeNull();
  });

  it("clears both prefix and verb when the cursor is in plain text", () => {
    const { result } = renderHarness();
    act(() => {
      result.current.prefix.recomputePrefix("#ta", 3);
    });
    expect(result.current.prefix.activePrefix).not.toBeNull();

    act(() => {
      result.current.prefix.recomputePrefix("hello world", 11);
    });
    expect(result.current.prefix.activePrefix).toBeNull();
    expect(result.current.prefix.activeVerb).toBeNull();
  });

  it("detects a verb only when no single-char prefix is active", () => {
    const { result } = renderHarness();
    act(() => {
      result.current.setInputValue(":fi");
    });
    act(() => {
      result.current.prefix.recomputePrefix(":fi", 3);
    });
    // ':' is not a noun prefix, so verb detection runs.
    expect(result.current.prefix.activePrefix).toBeNull();
    const verb = result.current.prefix.activeVerb;
    expect(verb).not.toBeNull();
    // 'fi' matches no registered verb → discovery state (verb: null).
    expect(verb?.verb).toBeNull();
    expect(verb?.typedName).toBe("fi");
    expect(result.current.prefix.activeVerbRef.current).toBe(verb);
  });

  it("resolves a full verb name to its registered mode", () => {
    const { result } = renderHarness();
    act(() => {
      result.current.prefix.recomputePrefix(":file foo", 9);
    });
    const verb = result.current.prefix.activeVerb;
    expect(verb?.verb?.name).toBe("file");
    expect(verb?.filter).toBe("foo");
  });

  describe("Esc-dismissal suppression (noun prefix, #126)", () => {
    it("suppresses re-detection of the same dismissed prefix at the same index", () => {
      const { result } = renderHarness();
      // Simulate an Esc dismissal of the '/' prefix at index 0.
      act(() => {
        result.current.prefix.dismissedPrefixRef.current = {
          index: 0,
          char: "/",
        };
      });
      act(() => {
        result.current.prefix.recomputePrefix("/de", 3);
      });
      // Still suppressed — picker stays closed.
      expect(result.current.prefix.activePrefix).toBeNull();
      expect(result.current.prefix.activeVerb).toBeNull();
      // Suppression ref is NOT cleared while the pattern still holds.
      expect(result.current.prefix.dismissedPrefixRef.current).toEqual({
        index: 0,
        char: "/",
      });
    });

    it("clears suppression once the dismissed pattern is broken", () => {
      const { result } = renderHarness();
      act(() => {
        result.current.prefix.dismissedPrefixRef.current = {
          index: 0,
          char: "/",
        };
      });
      // Different prefix char at index 0 → pattern broken.
      act(() => {
        result.current.prefix.recomputePrefix("@de", 3);
      });
      expect(result.current.prefix.activePrefix?.mode.prefix).toBe("@");
      expect(result.current.prefix.dismissedPrefixRef.current).toBeNull();
    });
  });

  describe("Esc-dismissal suppression (verb)", () => {
    it("suppresses re-detection of a dismissed verb at the same index", () => {
      const { result } = renderHarness();
      act(() => {
        result.current.prefix.dismissedVerbRef.current = { index: 0 };
      });
      act(() => {
        result.current.prefix.recomputePrefix(":fi", 3);
      });
      expect(result.current.prefix.activeVerb).toBeNull();
      expect(result.current.prefix.dismissedVerbRef.current).toEqual({
        index: 0,
      });
    });

    it("clears verb suppression when a verb is detected at a different index", () => {
      const { result } = renderHarness();
      // A dismissal recorded at some stale index.
      act(() => {
        result.current.prefix.dismissedVerbRef.current = { index: 5 };
      });
      // A fresh ':file' verb at index 0 — not the suppressed index → the guard
      // falls through, clears the ref, and the verb activates.
      act(() => {
        result.current.prefix.recomputePrefix(":file", 5);
      });
      expect(result.current.prefix.activeVerb?.verb?.name).toBe("file");
      expect(result.current.prefix.dismissedVerbRef.current).toBeNull();
    });
  });

  describe("active-option / drilldown teardown", () => {
    it("clears activeOption and drilldown seeds when the prefix flips to null", () => {
      const { result } = renderHarness();
      // Arm a prefix, an active option, and a drilldown seed.
      act(() => {
        result.current.prefix.recomputePrefix("#ta", 3);
      });
      act(() => {
        result.current.prefix.setActiveOption({
          listboxId: "lb",
          activeOptionId: "opt-1",
          count: 3,
        });
        result.current.prefix.setPendingTagDrilldown("foo");
        result.current.prefix.setPendingMentionDrilldown("bar");
      });
      expect(result.current.prefix.activeOption).not.toBeNull();
      expect(result.current.prefix.pendingTagDrilldown).toBe("foo");

      // Closing the prefix triggers the teardown effect.
      act(() => {
        result.current.prefix.setActivePrefix(null);
      });
      expect(result.current.prefix.activeOption).toBeNull();
      expect(result.current.prefix.pendingTagDrilldown).toBeNull();
      expect(result.current.prefix.pendingMentionDrilldown).toBeNull();
    });
  });

  describe("token replacement helpers", () => {
    it("handlePickSkill replaces the active token with `/<name> `", () => {
      const { result } = renderHarness();
      act(() => {
        result.current.setInputValue("/de");
      });
      act(() => {
        result.current.prefix.recomputePrefix("/de", 3);
      });
      act(() => {
        result.current.prefix.handlePickSkill("deploy");
      });
      expect(result.current.inputValue).toBe("/deploy ");
      // The prefix is cleared after replacement.
      expect(result.current.prefix.activePrefix).toBeNull();
    });

    it("handlePickSkill preserves text after the token", () => {
      const { result } = renderHarness();
      act(() => {
        result.current.setInputValue("/de rest");
      });
      act(() => {
        result.current.prefix.recomputePrefix("/de rest", 3);
      });
      act(() => {
        result.current.prefix.handlePickSkill("deploy");
      });
      expect(result.current.inputValue).toBe("/deploy  rest");
    });

    it("handlePickVerb replaces the `:typed` slice with `:<name> `", () => {
      const { result } = renderHarness();
      act(() => {
        result.current.setInputValue(":fi");
      });
      act(() => {
        result.current.prefix.recomputePrefix(":fi", 3);
      });
      act(() => {
        result.current.prefix.handlePickVerb("file");
      });
      expect(result.current.inputValue).toBe(":file ");
    });

    it("handlePickVerb is a no-op when no verb is active", () => {
      const { result } = renderHarness();
      act(() => {
        result.current.setInputValue("plain");
      });
      act(() => {
        result.current.prefix.handlePickVerb("file");
      });
      // Unchanged — activeVerbRef.current is null.
      expect(result.current.inputValue).toBe("plain");
    });
  });
});
