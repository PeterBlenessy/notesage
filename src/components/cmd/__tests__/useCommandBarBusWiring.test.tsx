// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import "@/test/tauri-mock";
import {
  useCommandBarBusWiring,
  type UseCommandBarBusWiringArgs,
} from "@/components/cmd/useCommandBarBusWiring";
import { type CommandBarPrefixState } from "@/components/cmd/useCommandBarPrefixState";
import { type EditContext } from "@/components/cmd/useResendEditDialog";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { useCmdBarSummonStore } from "@/stores/cmd-bar-summon-store";
import { type ActivePrefix } from "@/components/cmd/prefix-modes";
import { type ActiveVerb } from "@/components/cmd/verb-modes";

/**
 * Tests for `useCommandBarBusWiring` — the FloatingCommandBar's summon/dismiss
 * wiring. The hook subscribes to the `cmd-bar-events` bus and translates
 * durable summons into bus focus events. We drive it with a mock prefix-state
 * object plus vi.fn() setters and assert routing, multi-stage Esc semantics,
 * listener cleanup on unmount, and durable-summon consumption.
 */

function makePrefix(
  overrides: Partial<CommandBarPrefixState> = {},
): CommandBarPrefixState {
  const activePrefixRef: React.RefObject<ActivePrefix | null> = {
    current: null,
  };
  const activeVerbRef: React.RefObject<ActiveVerb | null> = { current: null };
  return {
    activePrefix: null,
    setActivePrefix: vi.fn(),
    activePrefixRef,
    activeVerb: null,
    setActiveVerb: vi.fn(),
    activeVerbRef,
    dismissedPrefixRef: { current: null },
    dismissedVerbRef: { current: null },
    activeOption: null,
    setActiveOption: vi.fn(),
    pendingTagDrilldown: null,
    setPendingTagDrilldown: vi.fn(),
    pendingMentionDrilldown: null,
    setPendingMentionDrilldown: vi.fn(),
    recomputePrefix: vi.fn(),
    handlePickSkill: vi.fn(),
    handlePickVerb: vi.fn(),
    ...overrides,
  };
}

interface Args {
  prefix: CommandBarPrefixState;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  setInputValue: ReturnType<typeof vi.fn>;
  setChips: ReturnType<typeof vi.fn>;
  setExpanded: ReturnType<typeof vi.fn>;
  setChatView: ReturnType<typeof vi.fn>;
  editContextRef: React.RefObject<EditContext | null>;
  clearEditContext: ReturnType<typeof vi.fn>;
  collapse: ReturnType<typeof vi.fn>;
}

function makeArgs(overrides: Partial<Args> = {}): Args {
  return {
    prefix: makePrefix(),
    inputRef: { current: null },
    setInputValue: vi.fn(),
    setChips: vi.fn(),
    setExpanded: vi.fn(),
    setChatView: vi.fn(),
    editContextRef: { current: null },
    clearEditContext: vi.fn(),
    collapse: vi.fn(),
    ...overrides,
  };
}

function mount(args: Args) {
  return renderHook(() =>
    useCommandBarBusWiring(args as unknown as UseCommandBarBusWiringArgs),
  );
}

describe("useCommandBarBusWiring", () => {
  beforeEach(() => {
    useCmdBarSummonStore.setState({ pending: null });
  });

  describe("focus events", () => {
    it("expands the bar on a bare focus event", () => {
      const args = makeArgs();
      mount(args);
      act(() => emitCmdBarEvent({ type: "focus" }));
      expect(args.setExpanded).toHaveBeenCalledWith(true);
    });

    it("prefills a noun prefix and pre-arms the active-prefix state", () => {
      const args = makeArgs();
      mount(args);
      act(() => emitCmdBarEvent({ type: "focus", prefix: "#" }));
      expect(args.setInputValue).toHaveBeenCalledWith("#");
      expect(args.prefix.setActivePrefix).toHaveBeenCalledWith(
        expect.objectContaining({
          prefixIndex: 0,
          tokenStart: 0,
          tokenEnd: 1,
          source: "chord",
          mode: expect.objectContaining({ prefix: "#" }),
        }),
      );
    });

    it("seeds a verb chord (:file ) into active-verb state", () => {
      const args = makeArgs();
      mount(args);
      act(() => emitCmdBarEvent({ type: "focus", prefix: ":file " }));
      expect(args.setInputValue).toHaveBeenCalledWith(":file ");
      expect(args.prefix.setActiveVerb).toHaveBeenCalledWith(
        expect.objectContaining({
          verb: expect.objectContaining({ name: "file" }),
          verbStart: 0,
          source: "chord",
        }),
      );
      // Verb path forces the noun prefix off.
      expect(args.prefix.setActivePrefix).toHaveBeenCalledWith(null);
    });

    it("applies a tag drilldown seed and clears the mention seed", () => {
      const args = makeArgs();
      mount(args);
      act(() =>
        emitCmdBarEvent({
          type: "focus",
          drilldown: { kind: "tag", name: "roadmap" },
        }),
      );
      expect(args.prefix.setPendingTagDrilldown).toHaveBeenCalledWith("roadmap");
      expect(args.prefix.setPendingMentionDrilldown).toHaveBeenCalledWith(null);
    });

    it("clears both drilldown seeds when no drilldown is present", () => {
      const args = makeArgs();
      mount(args);
      act(() => emitCmdBarEvent({ type: "focus" }));
      expect(args.prefix.setPendingTagDrilldown).toHaveBeenCalledWith(null);
      expect(args.prefix.setPendingMentionDrilldown).toHaveBeenCalledWith(null);
    });
  });

  describe("dismiss events (multi-stage Esc)", () => {
    it("stage 1: a typed prefix is cleared without collapsing", () => {
      const prefix = makePrefix();
      prefix.activePrefixRef.current = {
        mode: {
          id: "tag",
          prefix: "#",
          label: "Tag",
          icon: "Hash",
          description: "",
        },
        prefixIndex: 0,
        tokenStart: 0,
        tokenEnd: 1,
        filter: "",
        source: "typed",
      };
      const args = makeArgs({ prefix });
      mount(args);
      act(() => emitCmdBarEvent({ type: "dismiss" }));
      expect(prefix.setActivePrefix).toHaveBeenCalledWith(null);
      // Suppression recorded so the picker doesn't immediately re-open.
      expect(prefix.dismissedPrefixRef.current).toEqual({ index: 0, char: "#" });
      // Bar stays expanded.
      expect(args.collapse).not.toHaveBeenCalled();
    });

    it("stage 1 (verb): a typed verb is cleared without collapsing", () => {
      const prefix = makePrefix();
      prefix.activeVerbRef.current = {
        verb: null,
        verbStart: 0,
        verbEnd: 3,
        filterStart: 3,
        filterEnd: 3,
        filter: "",
        typedName: "fi",
        source: "typed",
      };
      const args = makeArgs({ prefix });
      mount(args);
      act(() => emitCmdBarEvent({ type: "dismiss" }));
      expect(prefix.setActiveVerb).toHaveBeenCalledWith(null);
      expect(prefix.dismissedVerbRef.current).toEqual({ index: 0 });
      expect(args.collapse).not.toHaveBeenCalled();
    });

    it("stage 2: an active edit context is cancelled before collapsing", () => {
      const editContextRef: React.RefObject<EditContext | null> = {
        current: { parentId: null, originalContent: "hi" },
      };
      const args = makeArgs({ editContextRef });
      mount(args);
      act(() => emitCmdBarEvent({ type: "dismiss" }));
      expect(args.clearEditContext).toHaveBeenCalled();
      expect(args.setInputValue).toHaveBeenCalledWith("");
      expect(args.setChips).toHaveBeenCalledWith([]);
      expect(args.collapse).not.toHaveBeenCalled();
    });

    it("stage 3: nothing to cancel → collapse", () => {
      const args = makeArgs();
      mount(args);
      act(() => emitCmdBarEvent({ type: "dismiss" }));
      expect(args.collapse).toHaveBeenCalledTimes(1);
    });

    it("a chord-seeded prefix skips stage 1 and collapses immediately", () => {
      const prefix = makePrefix();
      prefix.activePrefixRef.current = {
        mode: {
          id: "tag",
          prefix: "#",
          label: "Tag",
          icon: "Hash",
          description: "",
        },
        prefixIndex: 0,
        tokenStart: 0,
        tokenEnd: 1,
        filter: "",
        source: "chord",
      };
      const args = makeArgs({ prefix });
      mount(args);
      act(() => emitCmdBarEvent({ type: "dismiss" }));
      expect(prefix.setActivePrefix).not.toHaveBeenCalled();
      expect(args.collapse).toHaveBeenCalledTimes(1);
    });
  });

  describe("toggle-history & close events", () => {
    it("toggle-history expands the bar and flips the chat view", () => {
      const args = makeArgs();
      mount(args);
      act(() => emitCmdBarEvent({ type: "toggle-history" }));
      expect(args.setExpanded).toHaveBeenCalledWith(true);
      expect(args.setChatView).toHaveBeenCalledTimes(1);
      // The updater flips history <-> chat.
      const updater = args.setChatView.mock.calls[0][0] as (
        prev: "chat" | "history",
      ) => "chat" | "history";
      expect(updater("chat")).toBe("history");
      expect(updater("history")).toBe("chat");
    });

    it("close forcibly tears the bar down without collapse's guards", () => {
      const args = makeArgs();
      mount(args);
      act(() => emitCmdBarEvent({ type: "close" }));
      expect(args.setExpanded).toHaveBeenCalledWith(false);
      expect(args.prefix.setActivePrefix).toHaveBeenCalledWith(null);
      expect(args.prefix.setActiveVerb).toHaveBeenCalledWith(null);
      // 'close' bypasses collapse() entirely.
      expect(args.collapse).not.toHaveBeenCalled();
    });
  });

  describe("listener cleanup", () => {
    it("stops routing events after unmount", () => {
      const args = makeArgs();
      const { unmount } = mount(args);
      act(() => emitCmdBarEvent({ type: "focus" }));
      expect(args.setExpanded).toHaveBeenCalledTimes(1);

      unmount();
      args.setExpanded.mockClear();
      act(() => emitCmdBarEvent({ type: "focus" }));
      expect(args.setExpanded).not.toHaveBeenCalled();
    });
  });

  describe("durable summon", () => {
    it("consumes a pending summon and routes it through the focus handler", () => {
      const args = makeArgs();
      mount(args);
      act(() => {
        useCmdBarSummonStore.getState().summon({ prefix: "#" });
      });
      // The summon effect emits a focus event that the mounted subscriber
      // handles synchronously.
      expect(args.setExpanded).toHaveBeenCalledWith(true);
      expect(args.setInputValue).toHaveBeenCalledWith("#");
      // Pending is consumed so it doesn't re-fire.
      expect(useCmdBarSummonStore.getState().pending).toBeNull();
    });
  });
});
