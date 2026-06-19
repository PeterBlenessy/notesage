import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useChatSwitchPrompts } from "@/hooks/useChatSwitchPrompts";
import { useSettingsStore } from "@/stores/settings-store";
import {
  useChatStore,
  selectMessages,
  selectProjectPaths,
  selectPendingProjectSwitch,
  selectPendingAgentSwitch,
} from "@/stores/chat-store";
import { ChatHistoryView } from "@/components/chat/ChatHistoryView";
import { ContextPill } from "@/components/chat/ContextPill";
import { useChatContext } from "@/hooks/useChatContext";
import { FILE_DRAG_MIME } from "@/components/sidebar/quiet/file-drag";
import { useAIOperations } from "@/hooks/useAIOperations";
import { useForegroundLoading } from "@/hooks/useSessionManager";
import { useRoutingStore } from "@/stores/routing-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { toast } from "sonner";
import {
  ArrowUp,
  BookOpen,
  CheckSquare,
  FileText,
  Hash,
  ImagePlus,
  MessageSquare,
  Plus,
  Square,
  User,
  X,
  type LucideIcon,
} from "lucide-react";

// Inline chip icon map (live-test 2026-04-26 round 6) — replaces the
// `<AttachmentChips>` component for the cmd-bar input strip so chips
// render as direct flex siblings of image thumbnails (guaranteed
// left-to-right ordering by DOM position).
const CHIP_ICONS: Record<AttachmentChip["kind"], LucideIcon> = {
  file: FileText,
  person: User,
  comment: MessageSquare,
  tag: Hash,
  task: CheckSquare,
  research: BookOpen,
};
import type { ChatMessage as ChatMessageType, ImageAttachment } from "@/lib/ai/types";
import { compressImage } from "@/lib/image-compress";
import {
  registerSendImageHandler,
  unregisterSendImageHandler,
} from "@/lib/ai/vision";
// AttachmentStrip is no longer used here — chips render inline next
// to the textarea (live-test 2026-04-25).
import {
  ResendProviderDialog,
  type ResendProviderChoice,
  type ResendProviderOption,
} from "@/components/chat/ResendProviderDialog";
import {
  expandSkillPrefix,
  interpretAgentPrefix,
} from "@/lib/ai/chat-expansion";
import { subscribeToCmdBarEvents, emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { useCmdBarSummonStore } from "@/stores/cmd-bar-summon-store";
import { MODES } from "@/components/cmd/prefix-modes";
import CommandBarContext from "@/components/cmd/CommandBarContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type AttachmentChip } from "@/components/cmd/AttachmentChips";
import CommandBarStream from "@/components/cmd/CommandBarStream";
import {
  detectActivePrefix,
  type ActivePrefix,
} from "@/components/cmd/prefix-modes";
import {
  detectActiveVerb,
  computeTabCompletion,
  VERBS,
  type ActiveVerb,
} from "@/components/cmd/verb-modes";
import SkillMode from "@/components/cmd/modes/SkillMode";
import ReferenceMode from "@/components/cmd/modes/ReferenceMode";
import TagMode, { type TagPickAction } from "@/components/cmd/modes/TagMode";
import TaskMode, { type TaskAction } from "@/components/cmd/modes/TaskMode";
import ResearchMode from "@/components/cmd/modes/ResearchMode";
import PaletteMode from "@/components/cmd/modes/PaletteMode";
import FileMode from "@/components/cmd/modes/FileMode";
import { log } from "@/lib/logger";

/**
 * Pinned-mode width clamping constants — kept at module scope so the resize
 * handle, store setter, and CSS variable fallback all agree on the same
 * range. Mirrors the clamp in `setCmdBarPinnedWidth`.
 */
const PINNED_WIDTH_MIN = 280;
const PINNED_WIDTH_MAX = 800;
const PINNED_WIDTH_DEFAULT = 400;
const PINNED_WIDTH_KEYBOARD_STEP = 20;

/**
 * Floating-mode (expanded) width clamping constants — mirror of the pinned
 * constants above for the centred-overlay shape. The bar stays horizontally
 * centred so the resize handle delta is doubled when applying — dragging
 * the right edge by 50 px grows the bar by 100 px (both edges move).
 * Live-test 2026-04-26.
 */
const EXPANDED_WIDTH_MIN = 480;
const EXPANDED_WIDTH_MAX = 1400;
const EXPANDED_WIDTH_DEFAULT = 640;
const EXPANDED_WIDTH_KEYBOARD_STEP = 20;

/**
 * Floating-mode (expanded) height clamping constants. 240 keeps the input
 * row and action buttons visible; 800 avoids the bar dominating smaller
 * displays. Default 480 matches the previous hardcoded value so existing
 * users see zero visual change after upgrade. Issue #37.
 */
const EXPANDED_HEIGHT_MIN = 240;
const EXPANDED_HEIGHT_MAX = 800;
const EXPANDED_HEIGHT_DEFAULT = 480;
const EXPANDED_HEIGHT_KEYBOARD_STEP = 20;

/**
 * FloatingCommandBar — the unified composer shell for the Quiet Composer
 * UI refresh (PRD `2026-04-21-ui-refresh`, Phase 1, task #9).
 *
 * This file is intentionally just the bar's outer chrome. It hosts:
 *   - Compact state: a centred placeholder pill near the bottom of the
 *     viewport that hints at the ⌘K shortcut.
 *   - Expanded state: the same pill grows in height to ~480 px and reveals
 *     an autofocused input plus an empty scroll region for the future
 *     conversation stream.
 *
 * Subsequent tasks fill in the contents:
 *   - #10 CommandBarContext      → context row (provider, projects, mode)
 *   - #11 AttachmentChips        → chips above the input
 *   - #12 CommandBarStream       → real chat stream replaces the placeholder
 *   - #13 prefix morph           → /, @, #, !, ?, > mode switching (this file
 *                                  reports the active prefix; pickers in
 *                                  #14–#19 render the dropdowns)
 *   - #28 pinned panel layout    → wires up the `isPinned` branch
 *
 * Behaviour summary:
 *   - Click the compact pill (or open via ⌘K — handled by a future task) to
 *     expand. The input autofocuses.
 *   - Esc collapses back to compact and blurs the input. When a prefix mode
 *     is active, the first Esc clears the active prefix only; a second Esc
 *     collapses the bar (fall-through).
 *   - On focus, the bar lifts 14 px with a 200 ms ease transition. When
 *     `prefers-reduced-motion: reduce` is set, the lift and the height
 *     transition are skipped — the bar just snaps.
 *   - When `isPinned` is true the bar renders inline (no portal). Caller
 *     positions it; this component does not paint pinned-mode chrome yet.
 */

export interface FloatingCommandBarProps {
  /**
   * When provided, overrides the persisted `cmdBarPinned` setting from
   * settings-store. Tests pass this explicitly; production call sites should
   * leave it undefined and let the store drive the mode (so the pin icon in
   * `CommandBarContext` is the single source of truth). Forward-declared in
   * #9; wired to the store in #28.
   */
  isPinned?: boolean;
}

const COMPACT_PLACEHOLDER = "Press ⌘K to ask";

function FloatingCommandBar({ isPinned: isPinnedProp }: FloatingCommandBarProps) {
  // Read the persisted pinned flag. The prop overrides it (for tests / for
  // call sites that need to force a mode); when the prop is undefined, the
  // store wins so the pin-icon toggle in `CommandBarContext` works.
  const cmdBarPinnedSetting = useSettingsStore((s) => s.cmdBarPinned);
  const isPinned = isPinnedProp ?? cmdBarPinnedSetting;

  // Live-test 2026-04-26 — when transparent chrome is on, the collapsed
  // pill matches the title bar / status bar by going translucent over
  // the doc area. The bar portals to `document.body` and is NOT a
  // descendant of the QuietLayout root that carries the
  // `data-quiet-chrome-transparent` attribute, so we read the setting
  // directly here instead of relying on a descendant CSS selector.
  const quietChromeTransparent = useSettingsStore(
    (s) => s.quietChromeTransparent,
  );

  const [expanded, setExpanded] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [activePrefix, setActivePrefix] = useState<ActivePrefix | null>(null);
  // Mirror `activePrefix` onto a ref so the bus-subscription effect (which
  // mounts once) can read the latest value without being in its deps.
  // `activePrefix.source` drives Esc behaviour (typed → two-stage, chord →
  // one-stage collapse). The write happens DURING RENDER (not in useEffect)
  // so the ref is always in sync with the latest committed state by the
  // time React's commit phase finishes — eliminating any possibility of
  // a window-level keydown firing before the post-commit useEffect mirrors
  // the ref. (Mirror-via-useEffect was the previous pattern; #149 review
  // surfaced the timing race as a likely culprit for "Esc collapses bar
  // mid-edit" reports.)
  const activePrefixRef = useRef<ActivePrefix | null>(null);
  activePrefixRef.current = activePrefix;
  // Verb-prefix mirror — same shape as `activePrefix`, separate
  // namespace. Verbs and noun prefixes are mutually exclusive: when
  // `activePrefix` is non-null we force `activeVerb` to null so the
  // every-existing single-char chord keeps winning. PRD
  // `2026-04-28-cmd-bar-verb-prefixes`.
  const [activeVerb, setActiveVerb] = useState<ActiveVerb | null>(null);
  const activeVerbRef = useRef<ActiveVerb | null>(null);
  activeVerbRef.current = activeVerb;
  // Esc-suppression mirror of `dismissedPrefixRef` — when a typed
  // verb is dismissed via Esc, suppress re-detection of the same `:`
  // at the same index until the user actually deletes / replaces it.
  const dismissedVerbRef = useRef<{ index: number } | null>(null);
  // #126 fix — when a typed prefix is dismissed via Esc, suppress
  // re-detection of the SAME prefix character at the SAME index until
  // the user actually deletes or replaces it. Without this the picker
  // reopens on every subsequent keystroke (e.g. "/de" + Esc + Backspace
  // → "/d" → picker re-fires).
  const dismissedPrefixRef = useRef<{ index: number; char: string } | null>(
    null,
  );
  // Tracks the currently-highlighted option in the active mode picker so the
  // composer input can mirror it via `aria-activedescendant`. The picker
  // reports updates upward via its `onActiveOptionChange` callback (#78);
  // we reset to null whenever the active prefix flips off (no listbox open).
  const [activeOption, setActiveOption] = useState<{
    listboxId: string;
    activeOptionId: string | null;
    count: number;
  } | null>(null);

  // Drilldown seed forwarded from the bus `focus` event so sidebar
  // TagsSection / MentionsSection clicks can jump straight to level-2 of
  // the relevant picker (live-test 2026-04-26). Cleared whenever the
  // active prefix changes back to null.
  const [pendingTagDrilldown, setPendingTagDrilldown] = useState<string | null>(
    null,
  );
  const [pendingMentionDrilldown, setPendingMentionDrilldown] = useState<
    string | null
  >(null);
  // Live-test 2026-04-26 — keep the highlighted picker row in view when
  // arrow-key navigation runs past the visible window. Pickers report
  // their active option via `onActiveOptionChange`; we scroll that option
  // into view from one place rather than duplicating scrollIntoView logic
  // in every mode.
  useEffect(() => {
    const id = activeOption?.activeOptionId;
    if (!id) return;
    const el = document.getElementById(id);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeOption?.activeOptionId]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const reducedMotion = useReducedMotion();

  // Send wiring (#23). Uses `sendChatMessage` from `useAIOperations` so
  // all routing (direct API / ACP / Copilot LSP / local), provider lock
  // checks, segment isolation, and downstream streaming come "for free".
  const messagesForSend = useChatStore(selectMessages);
  const { sendChatMessage, cancelChat } = useAIOperations();
  // Per-conversation loading: the bar reflects the WATCHED conversation's run
  // state, not the global flag — so switching to an idle chat while another
  // streams in the background shows the right send/stop affordance (task #4).
  const isLoading = useForegroundLoading();

  // Live-test 2026-04-26 audit gap #10 — input + send must be disabled
  // while either an AgentSwitchCard or a pending-project-switch prompt
  // is awaiting the user's choice. Without this, users can keep
  // typing/sending mid-prompt, which races the resolver and may cause
  // messages to land on the wrong segment.
  const pendingProjectSwitch = useChatStore(selectPendingProjectSwitch);
  const pendingAgentSwitch = useChatStore(selectPendingAgentSwitch);
  const switchPending =
    Boolean(pendingProjectSwitch) || Boolean(pendingAgentSwitch);

  // Live-test 2026-04-26 audit gap #1 — mount the shared switch-prompt
  // hook so changing provider or project selection mid-conversation
  // raises the AgentSwitchCard / pending-project-switch prompt.
  // Without this, the bar would silently send messages to the new
  // provider with full prior history.
  useChatSwitchPrompts();

  // #118 — chatView toggles the expanded bar between its usual chat
  // stream and a past-conversation list. The clock icon in
  // `CommandBarContext` fires `toggle-history` on the bus; the
  // subscription below flips this state. Selecting a conversation from
  // the list returns to chat mode.
  const [chatView, setChatView] = useState<"chat" | "history">("chat");
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveConversation(id);
      setChatView("chat");
    },
    [setActiveConversation],
  );

  // #134 — context chips + explicit-attach offer. Auto-attached files
  // appear as ContextPill rows above the input; when the active tab
  // sits outside the selected project scope, an "Add this file to
  // chat" affordance lets the user opt in.
  const {
    contextItems,
    dismissItem,
    explicitAttachOffer,
    attachExplicit,
  } = useChatContext();

  // Voice input was removed from the command bar with the voice-subsystem
  // rewrite (PRD 2026-05-30-meeting-recording). The composer has no
  // microphone affordance — meeting recording lives on the StatusTray mic.

  // #127 parity — connection + routing state for the cross-provider
  // resend/edit dialog (minus the per-project `ai.provider` override
  // layer; a follow-up can extract that into a shared hook if needed).
  const interactiveConnection = useRoutingStore((s) =>
    s.getConnectionForUseCase("interactive"),
  );
  const allConnections = useConnectionsStore((s) => s.connections);
  const setRouting = useRoutingStore((s) => s.setRouting);

  // #127 parity — edit-mode state. When the user clicks Edit on a user
  // message, we capture the original parentId + connectionId so the
  // follow-up send can (a) branch from the edited message's parent
  // instead of appending to the leaf, and (b) surface a cross-provider
  // dialog if the active connection now differs.
  const [editContext, setEditContext] = useState<{
    parentId: string | null;
    originalContent: string;
    originalConnectionId?: string;
  } | null>(null);
  // Mirror on a ref so the bus-subscription effect can read the latest
  // edit-mode state without being in its deps. Drives the Esc stage
  // chain: typed-prefix → clear prefix; edit mode → cancel edit; neither
  // → collapse. Same render-phase write as `activePrefixRef` above —
  // post-commit useEffect mirroring left an open window where a fast
  // Esc keydown could fire with a stale ref and fall through to
  // collapse() instead of cancelling the edit (#149).
  const editContextRef = useRef<typeof editContext>(null);
  editContextRef.current = editContext;

  // #126 parity — image attachments. Paste, drag-drop, and the file
  // picker all dump ImageAttachments into this state; `handleSend` then
  // hands them to `sendChatMessage` where the Rust backend serializes
  // them per-provider. Cleared on successful send. The shared
  // `AttachmentStrip` component handles thumbnail rendering (see the
  // render block below the input).
  const [pendingAttachments, setPendingAttachments] = useState<
    ImageAttachment[]
  >([]);
  const addImageAttachment = useCallback((att: ImageAttachment) => {
    setPendingAttachments((prev) => {
      // Cap at 5 to match ChatInput's limit (user-facing toast if we
      // hit it — simpler than growing the strip unboundedly).
      if (prev.length >= 5) {
        toast.error("Max 5 images per message");
        return prev;
      }
      return [...prev, att];
    });
  }, []);
  const removeImageAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // #126 parity — subscribe to the vision event bus so editor "Add to
  // chat" actions and sidebar drops route their images into the
  // composer. Mounted once per bar instance — the bus rejects
  // duplicate registrations.
  useEffect(() => {
    registerSendImageHandler((attachment) => {
      addImageAttachment(attachment);
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => unregisterSendImageHandler();
  }, [addImageAttachment]);

  // #126 parity — pick images via the native dialog. Mirrors
  // `ChatInput.handleAttachClick`: read bytes + compress + push to the
  // strip. The file dialog is dynamically imported so the Tauri plugin
  // only loads when the user actually clicks the button.
  const handleImagePick = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        try {
          const bytes = await (await import("@/lib/tauri")).tauriApi.readBinaryFile(path);
          const name = path.split("/").pop() ?? "image";
          const ext = name.split(".").pop()?.toLowerCase() ?? "";
          const mimeMap: Record<string, string> = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            webp: "image/webp",
            bmp: "image/bmp",
            svg: "image/svg+xml",
          };
          const blob = new Blob([new Uint8Array(bytes)], {
            type: mimeMap[ext] ?? "image/png",
          });
          const attachment = await compressImage(blob, { name });
          addImageAttachment(attachment);
        } catch (err) {
          toast.error(`Failed to attach ${path}: ${err}`);
        }
      }
    } catch (err) {
      toast.error(`Failed to open image picker: ${err}`);
    }
  }, [addImageAttachment]);

  // #127 parity — cross-provider resend/edit dialog state. Opens when
  // the message's recorded connectionId differs from the active
  // `interactiveConnection`.
  interface ResendDialogState {
    mode: "resend" | "edit";
    content: string;
    messageIdToDelete?: string;
    originalConnectionId: string;
    currentConnectionId: string | null;
  }
  const [resendDialog, setResendDialog] = useState<ResendDialogState | null>(
    null,
  );

  // Attachment chips above the input (#11). Populated by the reference / task /
  // research mode pickers (#15 / #17 / #18) via the dispatchers below.
  const [chips, setChips] = useState<AttachmentChip[]>([]);
  const removeChip = useCallback((id: string) => {
    setChips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Whether the user is "composing" — used by TaskMode to choose between
  // navigate and attach. We treat any non-empty input or any pending chip as
  // composing; the picker uses this to pick the default Enter action.
  const isComposing = inputValue.trim().length > 0 || chips.length > 0;

  // Pinned mode is "always expanded" — the panel is permanent docking, so
  // there's no compact pill to click and no Esc-to-collapse behaviour. We
  // model this as a derived value (`effectiveExpanded`) so the rest of the
  // component logic can stay shared between floating and pinned.
  const effectiveExpanded = isPinned || expanded;

  // Autofocus the input whenever we transition into the expanded state.
  useEffect(() => {
    if (effectiveExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [effectiveExpanded]);

  // Drop the cached active-option info whenever the picker closes — there's
  // no listbox to point at, so `aria-activedescendant` and `aria-controls`
  // must be cleared together. Also clear pending drilldown seeds so the
  // next picker mount doesn't inherit a stale level-2 jump.
  useEffect(() => {
    if (!activePrefix) {
      setActiveOption(null);
      setPendingTagDrilldown(null);
      setPendingMentionDrilldown(null);
    }
  }, [activePrefix]);

  const expand = useCallback(() => {
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    // Pinned mode has no "collapsed" state — the panel always stays docked.
    // Esc still falls through to clear the prefix (handled in `handleKeyDown`)
    // but we never tear down the bar itself.
    if (isPinned) return;
    setExpanded(false);
    // Preserve the typed draft across collapse (Esc, blur, opening Settings, and
    // the X close button) so reopening restores what the user was writing — only
    // an actual send clears it. The prefix MODE is still reset; if the draft
    // begins with a prefix char it re-engages on the next keystroke.
    setActivePrefix(null);
    // Reset the typed-prefix dismissal suppression so the next time the
    // bar expands, the picker is willing to open again on the next `/`.
    dismissedPrefixRef.current = null;
    // Blur is a courtesy — the input itself unmounts when expanded === false,
    // but if we ever animate the input out we still want the focus released.
    inputRef.current?.blur();
  }, [isPinned]);

  // #114 — Subscribe to the `cmd-bar-events` bus so `useCommandBarShortcuts`
  // (⌘K, ⌘⇧P, ⌘1–4, Esc from outside the bar) and `useDoubleTapCmd` can drive
  // the bar's state. Previously the shortcut hook emitted on this bus but
  // nothing subscribed — the ⌘K gesture was silently dropped. Subscribing
  // here is the missing wire; once mounted, every chord observed by the
  // hook reaches the bar.
  //
  // focus events: expand the bar; if the intent carries a prefix character,
  // prefill the input with that character and pre-arm the active-prefix
  // state so the mode picker opens on the same tick.
  //
  // dismiss events: if the bar is expanded, collapse; if it's already
  // collapsed the handler is a no-op and the Esc keydown keeps propagating
  // to the editor / popover / focus-mode chain (the hook intentionally
  // does not preventDefault on Esc).
  // Durable summon path: the App-root dispatcher (`useGlobalShortcuts`) writes
  // keyboard summons (⌘K, ⌘⇧F, ⌘1–4, ⌘⇧P, double-⌘) to `cmd-bar-summon-store`
  // rather than the transient bus. Because the intent lives in durable state, a
  // bar that crashes (ErrorBoundary) and remounts reads the pending summon and
  // re-applies it via the same bus `focus` handler below — the summon survives
  // the crash (the old bus-only path dropped it whenever the single subscriber
  // was unmounted). We translate to the bus here so all the seeding logic stays
  // in one place.
  const pendingSummon = useCmdBarSummonStore((s) => s.pending);
  const consumeSummon = useCmdBarSummonStore((s) => s.consume);
  useEffect(() => {
    if (!pendingSummon) return;
    emitCmdBarEvent({
      type: "focus",
      prefix: pendingSummon.prefix,
      drilldown: pendingSummon.drilldown,
    });
    consumeSummon();
  }, [pendingSummon, consumeSummon]);

  // #114 — Subscribe to the `cmd-bar-events` bus so non-keyboard surfaces
  // (sidebar rows, toolbar buttons) and the durable summon effect above can
  // drive the bar's state.
  //
  // focus events: expand the bar; if the intent carries a prefix character,
  // prefill the input and pre-arm the active-prefix state so the mode picker
  // opens on the same tick.
  //
  // dismiss events: if the bar is expanded, collapse; if already collapsed the
  // handler is a no-op and the Esc keydown keeps propagating to the editor /
  // popover / focus-mode chain (the dispatcher does not preventDefault on Esc).
  useEffect(() => {
    return subscribeToCmdBarEvents((event) => {
      if (event.type === 'focus') {
        setExpanded(true);
        // Apply drilldown seed BEFORE setActivePrefix so the picker mounts
        // already pointed at level 2 (no level-1 flash).
        if (event.drilldown) {
          if (event.drilldown.kind === 'tag') {
            setPendingTagDrilldown(event.drilldown.name);
            setPendingMentionDrilldown(null);
          } else if (event.drilldown.kind === 'mention') {
            setPendingMentionDrilldown(event.drilldown.name);
            setPendingTagDrilldown(null);
          }
        } else {
          setPendingTagDrilldown(null);
          setPendingMentionDrilldown(null);
        }
        if (event.prefix) {
          // Verb chord seeds (PRD `2026-04-28-cmd-bar-verb-prefixes`).
          // Format `:<verb-name> ` — verb-prefix branch handled before
          // the single-char MODES lookup so a `:file ` chord doesn't
          // collide with the noun-prefix path.
          if (event.prefix.startsWith(':')) {
            // Strip optional trailing whitespace to find the verb
            // name; the seeded inputValue keeps the trailing space so
            // the cursor lands in the filter slot directly.
            const verbName = event.prefix.slice(1).trimEnd();
            const verb = VERBS[verbName as keyof typeof VERBS];
            if (verb) {
              setInputValue(event.prefix);
              const verbEnd = 1 + verb.name.length;
              const filterStart = event.prefix.length;
              setActiveVerb({
                verb,
                verbStart: 0,
                verbEnd,
                filterStart,
                filterEnd: event.prefix.length,
                filter: '',
                typedName: verb.name,
                // Chord-seeded: Esc collapses the bar in one stage.
                source: 'chord',
              });
              setActivePrefix(null);
            }
          } else {
            const mode = Object.values(MODES).find(
              (m) => m.prefix === event.prefix,
            );
            if (mode) {
              // Prefill with the prefix character only — no trailing space.
              // A space would (a) show an extra cursor-offset the user has to
              // delete, (b) count as post-prefix typed filter text and mis-seed
              // the picker's filter state. The input's onChange / selection
              // handlers handle cursor/filter state from here on as the user
              // types after the prefix.
              setInputValue(event.prefix);
              setActivePrefix({
                mode,
                prefixIndex: 0,
                tokenStart: 0,
                tokenEnd: 1,
                filter: '',
                // Chord-seeded: Esc collapses the bar in one stage (see the
                // dismiss branch below). A `'typed'` prefix would instead
                // require two Escs (first clears prefix, second collapses).
                source: 'chord',
              });
            }
          }
        }
        // Defer focus to the next tick so the input has rendered when the
        // bar transitioned from collapsed → expanded in the same pass.
        // Place the cursor AFTER the prefilled prefix so the user can type
        // the filter immediately. Without `setSelectionRange`, browsers
        // place the cursor at offset 0 on focus and the next keystroke
        // lands BEFORE the `#` / `@` (live-test 2026-04-26).
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (!el) return;
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        });
        return;
      }

      if (event.type === 'dismiss') {
        // Three-stage Esc mirror of the in-input `handleKeyDown`:
        //   1. Typed prefix (`#`, `@`, `!`, …) → clear the prefix only;
        //      the bar stays expanded so the user keeps composing. A
        //      chord-seeded prefix (⌘1/2/3/4, ⌘⇧P, ⌘⇧F) skips this
        //      stage and falls through to collapse — the chord was the
        //      only reason we landed there.
        //   2. Edit mode active (#127 iter-2 fix) → cancel the edit
        //      (clear context + the pre-filled input + chips). Bar
        //      stays expanded; the next Esc collapses it.
        //   3. Nothing to cancel → collapse the bar.
        //
        // Refs mirror the live state so the once-mounted subscriber
        // doesn't need them in its deps.
        const currentPrefix = activePrefixRef.current;
        if (currentPrefix?.source === 'typed') {
          // #126 fix — remember which prefix was dismissed so the next
          // keystroke doesn't immediately re-open the picker. Cleared
          // when the user deletes or replaces the prefix character.
          dismissedPrefixRef.current = {
            index: currentPrefix.prefixIndex,
            char: currentPrefix.mode.prefix,
          };
          setActivePrefix(null);
          // #126 focus-regression fix — the skill / tag / reference
          // picker takes keyboard focus while open; clearing the
          // prefix alone leaves focus on a now-hidden picker DOM, so
          // the next keystroke lands nowhere. Explicitly restore focus
          // to the input after the prefix state update settles.
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }

        // Verb Esc — same two-stage semantics as noun prefixes (PRD
        // `2026-04-28-cmd-bar-verb-prefixes`). Typed verb → first Esc
        // clears the verb (back to chat mode, bar stays expanded);
        // chord-seeded verb → first Esc collapses the bar.
        const currentVerb = activeVerbRef.current;
        if (currentVerb?.source === 'typed') {
          dismissedVerbRef.current = { index: currentVerb.verbStart };
          setActiveVerb(null);
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }

        if (editContextRef.current) {
          // #127 iter-2 — Esc cancels edit mode before collapsing.
          setEditContext(null);
          setInputValue('');
          setChips([]);
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }

        // In pinned mode the bar can't collapse — fall through to the
        // prefix-clearing behaviour in `collapse` (gated internally).
        // Otherwise collapse fully.
        collapse();
      }

      if (event.type === 'toggle-pin') {
        // #121 — ⌘⇧C pressed while the bar is expanded AND pinned. Flip the
        // pin off so the user returns to the floating overlay. The chord's
        // emit site in `useKeyboardShortcuts` already validated the state,
        // so we can setCmdBarPinned(false) unconditionally here.
        useSettingsStore.getState().setCmdBarPinned(false);
      }

      if (event.type === 'toggle-history') {
        // #118 — Clock icon in the context row (and ⌘⇧H when wired)
        // flips the stream area between the chat view and the past-
        // conversation list. Ensure the bar is expanded so the new
        // mode has somewhere to render.
        setExpanded(true);
        setChatView((prev) => (prev === 'history' ? 'chat' : 'history'));
      }

      if (event.type === 'close') {
        // X button in the context row — forced collapse that bypasses
        // both the pin guard in `collapse()` and the multi-stage prefix
        // semantics in `dismiss`. The trigger is responsible for
        // unpinning before firing; this just tears the bar down.
        //
        // The X is the MOUSE equivalent of Esc-to-collapse, so it must
        // PRESERVE the typed draft exactly like `collapse()` does —
        // reopening restores what the user was writing. Only an actual send
        // clears the input. (Earlier this wiped the draft, which read as a
        // bug: closing then reopening lost the prompt.)
        setExpanded(false);
        setActivePrefix(null);
        setActiveVerb(null);
        dismissedPrefixRef.current = null;
        dismissedVerbRef.current = null;
        inputRef.current?.blur();
      }
    });
  }, [collapse]);

  // ---------------------------------------------------------------------
  // Prefix detection — runs on every input change AND on selection moves.
  //
  // We compute the active prefix from (value, selectionStart) so that moving
  // the cursor outside the prefix token (e.g. arrow-keying into a later word)
  // dismisses the picker without typing anything.
  // ---------------------------------------------------------------------

  const recomputePrefix = useCallback(
    (value: string, cursor: number) => {
      const next = detectActivePrefix(value, cursor);

      // #126 fix — suppress re-detection of an Esc-dismissed prefix
      // until the user breaks the pattern (deletes or replaces the
      // prefix char). Without this, typing then Esc then any keystroke
      // would re-open the picker because the prefix is still in the
      // value.
      const dismissed = dismissedPrefixRef.current;
      if (dismissed) {
        if (next && next.prefixIndex === dismissed.index && value[dismissed.index] === dismissed.char) {
          // Still suppressed.
          setActivePrefix(null);
          // Verb detection is also gated when a single-char prefix
          // would have won, so skip it here too.
          setActiveVerb(null);
          return;
        }
        // Pattern broken — clear suppression so future prefixes work.
        dismissedPrefixRef.current = null;
      }

      setActivePrefix(next);

      // Verb-prefix detection runs ONLY when no single-char prefix is
      // active. Single-char prefixes win to preserve every existing
      // chord (PRD `2026-04-28-cmd-bar-verb-prefixes`, "mutually
      // exclusive" rule).
      if (next) {
        setActiveVerb(null);
        return;
      }
      const verbNext = detectActiveVerb(value, cursor);
      const dismissedVerb = dismissedVerbRef.current;
      if (dismissedVerb) {
        if (verbNext && verbNext.verbStart === dismissedVerb.index && value[dismissedVerb.index] === ':') {
          setActiveVerb(null);
          return;
        }
        dismissedVerbRef.current = null;
      }
      setActiveVerb(verbNext);
    },
    [],
  );

  // Live-test 2026-04-25 #151 — auto-resize the cmd-bar textarea so it
  // grows with multi-line content.
  // Caps at 160 px (~6 lines) so the bar can't push past the doc area;
  // beyond that the textarea scrolls internally. Called from
  // `handleInputChange` AND from a `useEffect` on `inputValue` so
  // programmatic value changes (e.g. prefix replacement) resize the
  // textarea too.
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [inputValue, autoResize]);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      const cursor = event.target.selectionStart ?? value.length;
      setInputValue(value);
      recomputePrefix(value, cursor);
      autoResize();
    },
    [recomputePrefix, autoResize],
  );

  const handleSelectionChange = useCallback(
    (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
      // Ignore Escape's keyUp — its keyDown handler already cleared (or
      // collapsed) the prefix mode and we don't want to re-detect from the
      // unchanged input value and resurrect a badge the user just dismissed.
      if (
        "key" in event.nativeEvent &&
        (event.nativeEvent as KeyboardEvent).key === "Escape"
      ) {
        return;
      }
      const target = event.currentTarget;
      const cursor = target.selectionStart ?? target.value.length;
      recomputePrefix(target.value, cursor);
    },
    [recomputePrefix],
  );

  // ---------------------------------------------------------------------
  // Send (#23) — Enter (no active prefix) sends via the existing
  // `useAIOperations.sendChatMessage` pipeline. We REUSE this hook rather
  // than rebuild the streaming flow so the composer inherits provider
  // routing, project lock enforcement, segment isolation, and downstream
  // streaming behaviour.
  //
  // Chip handling for v1 is pragmatic: when the message has chips, we
  // prepend a tiny `[refs: …]` block so the references reach the model as
  // text. Tag chips already arrive as literal `#tag` text (TagMode keeps
  // the literal); `file`, `person`, `comment`, `task`, and `research`
  // chips are inlined here.
  //
  // TODO(#25 / future): Replace the inline-text fallback with a structured
  // `references` field on `sendChatMessage` opts so the chat-store can
  // surface them as proper chips on the resulting user message (matching
  // today's image-attachment thumbnails).
  // ---------------------------------------------------------------------

  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0 && chips.length === 0 && pendingAttachments.length === 0) {
      // Empty input AND no chips AND no images → no-op.
      return;
    }

    const refsBlock =
      chips.length > 0
        ? `[refs: ${chips.map((c) => `${c.kind}:${c.name}`).join(", ")}] `
        : "";
    const rawContent = `${refsBlock}${trimmed}`;

    // #126 parity — `@agent-name` / `/skill-name` expansion at send time
    // via the shared helpers in `src/lib/ai/chat-expansion.ts`. Skipping
    // these would send the literal prefix as model input, losing the
    // agent swap + skill-body injection the user expects.
    const agentResult = interpretAgentPrefix(rawContent, interactiveConnection);
    if (agentResult.skipSend) {
      // Only a bare `@agent-name` was typed — active agent has been
      // swapped; nothing more to do.
      setInputValue("");
      setChips([]);
      setActivePrefix(null);
      return;
    }
    const skillResult = await expandSkillPrefix(agentResult.content);
    if (skillResult.abortSend) return;
    const content = skillResult.content;

    // #127 parity — if we're editing a message and the active connection
    // now differs from the message's original connectionId, open the
    // dialog instead of sending. On confirm the dialog will fire the
    // actual send with the selected routing.
    if (
      editContext?.originalConnectionId &&
      editContext.originalConnectionId !== (interactiveConnection?.id ?? null)
    ) {
      setResendDialog({
        mode: "edit",
        content,
        originalConnectionId: editContext.originalConnectionId,
        currentConnectionId: interactiveConnection?.id ?? null,
      });
      // Leave editContext in place — the dialog's confirm path clears
      // it via `doSend`.
      return;
    }

    // Reset the composer optimistically — the send is async but the user
    // expects the input to clear immediately so they can keep typing.
    setInputValue("");
    setChips([]);
    setActivePrefix(null);

    // #127 parity — when editing, branch from the edited message's
    // parent instead of appending to the leaf. The chat-store's send
    // pipeline honours `parentId` in opts.
    // #126 parity — when a skill expanded, pass `displayContent` +
    // `skillName` so the user-visible bubble shows the original text
    // (not the expanded prompt) and the activity log tags the skill.
    const sendOpts: Record<string, unknown> = {};
    if (editContext) sendOpts.parentId = editContext.parentId;
    if (skillResult.skillName) {
      sendOpts.displayContent = rawContent;
      sendOpts.skillName = skillResult.skillName;
    }
    // #126 parity — image attachments reach the provider via the
    // `attachments` opt. Cleared optimistically alongside the input /
    // chips.
    if (pendingAttachments.length > 0) {
      sendOpts.attachments = pendingAttachments;
      setPendingAttachments([]);
    }
    if (editContext) setEditContext(null);

    // Fire-and-forget — the chat-store handles its own loading + error state
    // and the chat stream renders the assistant response.
    void sendChatMessage(
      content,
      messagesForSend,
      Object.keys(sendOpts).length > 0 ? sendOpts : undefined,
    );

    // Keep focus in the input for the next message. The autofocus effect on
    // `effectiveExpanded` doesn't re-fire when only the input value changes,
    // so we ensure focus explicitly here.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [
    inputValue,
    chips,
    pendingAttachments,
    sendChatMessage,
    messagesForSend,
    editContext,
    interactiveConnection,
  ]);

  // ---------------------------------------------------------------------
  // Stream → send bridge. `ChatMessageList` fires `onSend(content)` for
  // QuickReplies (user clicks a suggested follow-up) and onboarding
  // prompts (empty-state bubble buttons). Neither flows through the
  // composer input — they're direct send-a-specific-string calls, so
  // we bypass `handleSend`'s input-reading path and send `content`
  // verbatim.
  // ---------------------------------------------------------------------

  const handleStreamSend = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (trimmed.length === 0) return;

      // #126 parity — stream-originated sends (QuickReplies / onboarding
      // prompts) run through the same `@agent` / `/skill` pipeline as
      // the composer send. A quick-reply chip that begins with
      // `/research-source` should still hydrate the skill body.
      const agentResult = interpretAgentPrefix(trimmed, interactiveConnection);
      if (agentResult.skipSend) return;
      const skillResult = await expandSkillPrefix(agentResult.content);
      if (skillResult.abortSend) return;

      const sendOpts = skillResult.skillName
        ? { displayContent: trimmed, skillName: skillResult.skillName }
        : undefined;
      void sendChatMessage(skillResult.content, messagesForSend, sendOpts);
    },
    [sendChatMessage, messagesForSend, interactiveConnection],
  );

  // onPrefill: stream's empty-state onboarding prompts. Drop the content
  // into the input so the user can tweak before sending.
  const handleStreamPrefill = useCallback(
    (text: string) => {
      setInputValue(text);
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [],
  );

  // Resend a user message — same-provider path deletes + re-sends. On
  // cross-provider mismatch we open `ResendProviderDialog` so the user
  // can pick which connection receives the resend (#127 parity).
  const handleStreamResend = useCallback(
    (message: ChatMessageType) => {
      const currentId = interactiveConnection?.id ?? null;
      const originalId = message.connectionId ?? null;

      if (originalId && originalId !== currentId) {
        setResendDialog({
          mode: "resend",
          content: message.content,
          messageIdToDelete: message.id,
          originalConnectionId: originalId,
          currentConnectionId: currentId,
        });
        return;
      }

      if (message.id) {
        useChatStore.getState().deleteMessageAndDescendants(message.id);
      }
      const trimmed = message.content.trim();
      if (trimmed.length === 0) return;
      void sendChatMessage(trimmed, messagesForSend);
    },
    [sendChatMessage, messagesForSend, interactiveConnection?.id],
  );

  // Edit a user message — prefill the composer + capture edit context so
  // (a) the next send branches from the edited message's parent and (b)
  // a provider-mismatch dialog can fire at send time if the active
  // connection differs from the message's original `connectionId`.
  const handleStreamEdit = useCallback(
    (message: ChatMessageType) => {
      setEditContext({
        parentId: message.parentId !== undefined ? message.parentId : null,
        originalContent: message.content,
        originalConnectionId: message.connectionId,
      });
      setInputValue(message.content);
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [],
  );

  const clearEditContext = useCallback(() => setEditContext(null), []);

  // #127 parity — dialog confirm/cancel + memoized options for the
  // `ResendProviderDialog` render.
  const handleResendDialogConfirm = useCallback(
    (choice: ResendProviderChoice) => {
      const dialog = resendDialog;
      if (!dialog) return;
      setResendDialog(null);

      const targetId =
        choice === "original"
          ? dialog.originalConnectionId
          : dialog.currentConnectionId;

      // Resend path deletes the original response tree; edit-send never
      // deletes — it branches from the parentId captured in editContext.
      if (dialog.mode === "resend" && dialog.messageIdToDelete) {
        useChatStore
          .getState()
          .deleteMessageAndDescendants(dialog.messageIdToDelete);
      }

      // Per-dialog send opts differ by mode:
      //   - resend: always a fresh send of `dialog.content`
      //   - edit:   honor editContext.parentId so the edit branches from
      //             the right place; clear editContext after scheduling.
      const parentId =
        dialog.mode === "edit" ? editContext?.parentId ?? null : undefined;

      // Reset composer optimistically for edit sends (resend doesn't touch
      // the input — the content came straight from the message record).
      if (dialog.mode === "edit") {
        setInputValue("");
        setChips([]);
        setActivePrefix(null);
        setEditContext(null);
      }

      const runSend = () => {
        void sendChatMessage(
          dialog.content,
          messagesForSend,
          parentId !== undefined ? { parentId } : undefined,
        );
      };

      if (targetId && targetId !== (interactiveConnection?.id ?? null)) {
        // Reroute then schedule the send after React flush so the send
        // hooks pick up the rebuilt routing closure.
        setRouting("interactive", targetId);
        setTimeout(runSend, 0);
      } else {
        runSend();
      }
    },
    [
      resendDialog,
      editContext?.parentId,
      interactiveConnection?.id,
      setRouting,
      sendChatMessage,
      messagesForSend,
    ],
  );

  const handleResendDialogCancel = useCallback(() => {
    setResendDialog(null);
    // Leave editContext in place on cancel so the user can adjust or
    // abandon the edit themselves.
  }, []);

  const resendDialogOptions = useMemo<
    | { original: ResendProviderOption; current: ResendProviderOption; isEdit: boolean }
    | null
  >(() => {
    if (!resendDialog) return null;
    const originalConn =
      allConnections.find((c) => c.id === resendDialog.originalConnectionId) ??
      null;
    const currentConn = resendDialog.currentConnectionId
      ? allConnections.find((c) => c.id === resendDialog.currentConnectionId) ??
        null
      : null;

    const original: ResendProviderOption = {
      id: resendDialog.originalConnectionId,
      label:
        originalConn?.label ??
        `Removed connection (${resendDialog.originalConnectionId.slice(0, 8)}…)`,
      provider: originalConn?.provider ?? null,
      disabled: !originalConn,
      disabledReason: !originalConn
        ? `Original provider (${resendDialog.originalConnectionId}) is no longer connected.`
        : undefined,
    };
    const current: ResendProviderOption = {
      id: resendDialog.currentConnectionId,
      label: currentConn?.label ?? "No provider selected",
      provider: currentConn?.provider ?? null,
      disabled: !currentConn,
      disabledReason: !currentConn
        ? "No provider is currently selected. Configure one in Settings."
        : undefined,
    };
    return { original, current, isEdit: resendDialog.mode === "edit" };
  }, [resendDialog, allConnections]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        // #127/#126 fix — do NOT handle Esc locally. The window-level
        // `useCommandBarShortcuts` hook also fires Esc → emits a
        // `dismiss` event on the bus. Handling Esc in both places
        // raced: the local handler cleared the prefix, then the bus
        // saw no prefix and collapsed the bar. The bus subscriber is
        // now the single source of truth for the three-stage chain
        // (typed prefix → edit mode → collapse). We let the event
        // bubble untouched so the keyboard hook picks it up.
        return;
      }
      if (event.key === "Tab") {
        // Verb-name autocomplete (PRD `2026-04-28-cmd-bar-verb-prefixes`).
        // Only fires when a verb prefix is active AND the cursor is
        // in the verb-name region (not the filter slot — filter Tab
        // is the verb picker's to handle in #8). `computeTabCompletion`
        // returns null when there's nothing to do, in which case we
        // fall through and let the verb picker (or browser focus
        // traversal) take Tab.
        const el = event.currentTarget;
        const cursor = el.selectionStart ?? inputValue.length;
        const completion = computeTabCompletion(inputValue, cursor);
        if (completion) {
          event.preventDefault();
          setInputValue(completion.newInput);
          requestAnimationFrame(() => {
            const node = inputRef.current;
            if (!node) return;
            node.focus();
            node.setSelectionRange(completion.newCursor, completion.newCursor);
            // Force re-detect against the new value/cursor so the
            // verb picker (or discovery menu) updates without waiting
            // for the next input event.
            recomputePrefix(completion.newInput, completion.newCursor);
          });
          return;
        }
      }
      if (event.key === "Enter") {
        // When a prefix is active, Enter is reserved for the picker (handled
        // by mode pickers in #14–#19). We must NOT swallow Enter here — the
        // picker component owns it.
        if (activePrefix) {
          return;
        }
        // Allow newlines via Shift+Enter for forward-compat (the input is a
        // single-line `<input>` today, so this branch is just a guard for
        // when the bar grows a textarea).
        if (event.shiftKey) return;
        event.preventDefault();
        // `handleSend` is async (the `/skill-name` pipeline loads the skill
        // body via Tauri before dispatching the send). Fire and forget —
        // the chat stream owns the loading state.
        void handleSend();
        return;
      }
    },
    [activePrefix, editContext, collapse, handleSend, inputValue, recomputePrefix],
  );

  // ---------------------------------------------------------------------
  // Mode picker dispatchers (#14–#19)
  //
  // Each picker emits a domain-specific selection; these handlers translate
  // the selection into input-text / chip-state mutations. After applying,
  // the active prefix is cleared (the picker has done its job) and focus
  // returns to the input.
  // ---------------------------------------------------------------------

  /** Replace the active prefix token (prefix + filter) with the given string. */
  const replaceActiveToken = useCallback(
    (replacement: string) => {
      if (!activePrefix) return;
      const before = inputValue.slice(0, activePrefix.tokenStart);
      const after = inputValue.slice(activePrefix.tokenEnd);
      const next = before + replacement + after;
      const cursor = (before + replacement).length;
      setInputValue(next);
      setActivePrefix(null);
      // Restore cursor position after React applies the value.
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(cursor, cursor);
        }
      });
    },
    [activePrefix, inputValue],
  );

  const handlePickSkill = useCallback(
    (skillName: string) => {
      replaceActiveToken(`/${skillName} `);
    },
    [replaceActiveToken],
  );

  const handlePickTag = useCallback(
    (action: TagPickAction) => {
      // Live-test 2026-04-26 (slice 2) — TagMode owns the two-level
      // drilldown (tag list → occurrence list) internally. By the time
      // `onPick` fires, the user has selected a SPECIFIC occurrence;
      // we just dispatch the open-file-at-tag event with the precomputed
      // file/symbol/index. Bar + picker stay open per user direction.
      window.dispatchEvent(
        new CustomEvent("notesage:open-file-at-tag", {
          detail: {
            filePath: action.filePath,
            fileName: action.fileName,
            symbol: action.symbol,
            occurrenceInFile: action.occurrenceInFile,
          },
        }),
      );
    },
    [],
  );

  const handlePickReference = useCallback(
    (chip: AttachmentChip) => {
      // Live-test 2026-04-26 (slice 2) — handles file + comment direct
      // picks. `person` kind drills down internally in `ReferenceMode`
      // and reaches us via `handlePickReferenceOccurrence` below.
      if (chip.kind === "file") {
        const filePath = chip.id.startsWith("file:")
          ? chip.id.slice("file:".length)
          : chip.id;
        const fileName = filePath.split("/").pop() || filePath;
        window.dispatchEvent(
          new CustomEvent("notesage:open-file", {
            detail: { filePath, fileName },
          }),
        );
        return;
      }
      // comment kind — no navigation wired yet (the comment store maps
      // document UUIDs to file paths; resolving requires a separate pass
      // that's out of scope for slice 2).
    },
    [],
  );

  const handlePickReferenceOccurrence = useCallback(
    (action: {
      filePath: string;
      fileName: string;
      symbol: string;
      occurrenceInFile: number;
    }) => {
      // Slice 2 — `@person` drilldown delivered an occurrence pick.
      window.dispatchEvent(
        new CustomEvent("notesage:open-file-at-tag", {
          detail: {
            filePath: action.filePath,
            fileName: action.fileName,
            symbol: action.symbol,
            occurrenceInFile: action.occurrenceInFile,
          },
        }),
      );
    },
    [],
  );

  const handlePickResearch = useCallback(
    (chip: AttachmentChip) => {
      // Live-test 2026-04-26 — open the research file in a tab. Bar +
      // picker STAY OPEN per user direction: a wrong selection is one
      // arrow-key + Enter away. Esc dismisses when the user is done.
      const filePath = chip.id;
      const fileName = filePath.split("/").pop() || filePath;
      window.dispatchEvent(
        new CustomEvent("notesage:open-file", {
          detail: { filePath, fileName },
        }),
      );
    },
    [],
  );

  const handlePickTask = useCallback(
    (action: TaskAction) => {
      // Live-test 2026-04-26 — open the file at the task's text. Bar +
      // picker STAY OPEN so a wrong pick is one arrow + Enter away.
      // Esc dismisses.
      if (action.kind === "navigate") {
        const fileName =
          action.filePath.split("/").pop() || action.filePath;
        window.dispatchEvent(
          new CustomEvent("notesage:open-file", {
            detail: {
              filePath: action.filePath,
              fileName,
              scrollToText: action.text,
            },
          }),
        );
      }
    },
    [],
  );

  const handlePickPalette = useCallback(
    (commandId: string) => {
      // Live-test 2026-04-26 — fire the command via App.tsx's existing
      // listener (same callbacks as `useKeyboardShortcuts`). Bar + picker
      // STAY OPEN per user direction. Esc dismisses.
      window.dispatchEvent(
        new CustomEvent("notesage:palette-command", { detail: { commandId } }),
      );
      log.info("perf:cmdbar", "palette-execute", { commandId });
    },
    [],
  );

  // Verb discovery menu picked a verb name (PRD
  // `2026-04-28-cmd-bar-verb-prefixes`). Replace the `:typedName`
  // slice with `:fullName ` and jump cursor into the filter slot.
  // Mirrors the single-match path in `computeTabCompletion`.
  const handlePickVerb = useCallback(
    (verbName: string) => {
      const current = activeVerbRef.current;
      if (!current) return;
      const before = inputValue.slice(0, current.verbStart);
      const after = inputValue.slice(current.verbEnd);
      const needsSpace = after === '' || !/\s/.test(after[0]);
      const replaced = `:${verbName}${needsSpace ? ' ' : ''}`;
      const newInput = before + replaced + after;
      const newCursor = before.length + replaced.length;
      setInputValue(newInput);
      requestAnimationFrame(() => {
        const node = inputRef.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(newCursor, newCursor);
        recomputePrefix(newInput, newCursor);
      });
    },
    [inputValue, recomputePrefix],
  );

  // ---------------------------------------------------------------------
  // Visual chrome
  //
  // The bar is the same DOM in both compact and expanded states — only the
  // size, contents, and lift offset differ. Tailwind `h-*` + `transition-all`
  // gives a smooth height/opacity morph; reduced-motion strips both the
  // transition utility and the lift transform.
  // ---------------------------------------------------------------------

  // Position / sizing depend on the current mode:
  //   - pinned       → fixed right-edge full-height side panel; width comes
  //                    from the `--cmd-bar-pinned-width` CSS variable so the
  //                    drag handle can mutate it without React re-renders
  //   - floating + expanded → centered overlay near the bottom, fixed width
  //   - floating + compact  → smaller pill, same horizontal centring
  //
  // In pinned mode the panel is always "expanded" — there's no compact pill
  // and no height collapse. We still funnel through `effectiveExpanded` so
  // a single conditional below picks the right content slot.
  // Live-test 2026-04-25 — floating-mode horizontal centre is now the
  // doc-area's centre, NOT the window's. The QuietLayout root publishes
  // `--quiet-sidebar-width` (252 px when pinned, 0 px otherwise); we
  // shift the centre right by half that width so the bar visually
  // belongs to the document. Using a CSS variable keeps the layout
  // logic in one place — toggling the sidebar reflows the bar without
  // any JS. `left: calc(50% + var(--quiet-sidebar-width, 0px) / 2)`
  // lands the bar's translation anchor on the doc-area's centerline.
  const positionClasses = isPinned
    ? "fixed top-0 right-0 h-screen"
    : "fixed bottom-10 left-[calc(50%+var(--quiet-sidebar-width,0px)/2)] -translate-x-1/2";

  const widthClasses = isPinned
    ? // Width is driven by the CSS variable. We set a Tailwind w-* fallback
      // (defaults to PINNED_WIDTH_DEFAULT) for the very first paint before
      // the inline style is applied. `max-w-[90vw]` keeps the panel sane on
      // narrow windows.
      "max-w-[90vw]"
    : effectiveExpanded
      ? // Width is driven by the `--cmd-bar-expanded-width` CSS variable for
        // the same reason as pinned mode — drag-to-resize without React
        // re-renders. The variable falls back to EXPANDED_WIDTH_DEFAULT so
        // first paint is unchanged. Live-test 2026-04-26.
        "max-w-[90vw]"
      : "w-[480px] max-w-[90vw]";

  const heightClasses = isPinned
    ? "" // pinned: full-screen height owned by `positionClasses`
    : effectiveExpanded
      ? "" // expanded: height driven by --cmd-bar-expanded-height CSS variable via inlineStyle
      : "h-12";

  // Pinned panel uses square corners on the right edge (it's flush against
  // the window) and only rounds the left side.
  const radiusClasses = isPinned
    ? "rounded-l-2xl rounded-r-none"
    : effectiveExpanded
      ? "rounded-2xl"
      : "rounded-xl";

  // 14 px lift on focus / when expanded — only for the floating overlay.
  // Pinned mode is permanent docking; lift would feel out of place.
  const liftClasses =
    !reducedMotion && expanded && !isPinned ? "-translate-y-[14px]" : "";

  // Fixed-position overlay needs a vertical translate that combines with
  // the horizontal -translate-x-1/2. We layer them via Tailwind's transform
  // composition: `-translate-x-1/2` already sets transform; the lift then
  // composes via the additional `-translate-y-[14px]` utility.

  const transitionClasses = reducedMotion
    ? ""
    : "transition-all duration-200 ease-out";

  // Inline style — pinned and floating-expanded modes both drive their width
  // via a CSS variable cascaded from <html> (the resize handles write to it
  // on every pointermove without re-rendering React). Collapsed floating
  // mode keeps a Tailwind w-* class instead.
  const inlineStyle: React.CSSProperties = isPinned
    ? { width: `var(--cmd-bar-pinned-width, ${PINNED_WIDTH_DEFAULT}px)` }
    : effectiveExpanded
      ? {
          width: `var(--cmd-bar-expanded-width, ${EXPANDED_WIDTH_DEFAULT}px)`,
          height: `var(--cmd-bar-expanded-height, ${EXPANDED_HEIGHT_DEFAULT}px)`,
        }
      : {};

  const bar = (
    <div
      data-cmd-bar
      data-cmd-bar-pinned={isPinned ? "true" : "false"}
      data-expanded={effectiveExpanded ? "true" : "false"}
      data-prefix-mode={activePrefix?.mode.id ?? ""}
      // Pinned mode is a permanent docked panel — give AT users a landmark to
      // jump to. Floating mode is a transient overlay; no region role applied
      // there per the spec (#82).
      role={isPinned ? "region" : undefined}
      aria-label={isPinned ? "Chat panel" : undefined}
      style={inlineStyle}
      className={cn(
        positionClasses,
        widthClasses,
        heightClasses,
        radiusClasses,
        liftClasses,
        transitionClasses,
        // z-30 in pinned mode — slightly behind floating overlays so dialogs
        // still appear on top. Floating mode keeps z-40 to sit above the
        // editor and friends.
        isPinned ? "z-30" : "z-40",
        "flex flex-col overflow-hidden",
        // Live-test 2026-04-25 #155 — was `bg-popover/95` which let the
        // layout-root bleed through and read as a faint grey. Going to
        // full-opacity `bg-popover` (pure white in default light mode)
        // makes the bar visibly cleaner against the doc area. The
        // shadcn Popover (StatusTray, etc.) already uses full
        // opacity — the bar now matches.
        "border border-border shadow-lg",
        // Aligned with the editor pill toolbar (`Toolbar.tsx`'s
        // `isPill` branch) so the two floating chrome elements read as
        // one family. Opaque `bg-popover` by default; translucent
        // `bg-popover/70 backdrop-blur-[14px]` when the operator has
        // opted into `quietChromeTransparent`. Earlier this branch
        // used `bg-background/40 backdrop-blur-xl` (mirroring TitleBar)
        // but `/40` over a contrasting document (white-bg PDF in dark
        // mode) let too much underlying lightness through, breaking
        // legibility — operator-reported. `/70` over `bg-popover`
        // (slightly lighter than canvas in dark mode per design system
        // elevation cue) reads cleanly against either light or dark
        // documents in either theme.
        //
        // Expanded and pinned modes still stay opaque (full `bg-popover`)
        // so chat stream content reads cleanly on top.
        !effectiveExpanded && !isPinned && quietChromeTransparent
          ? "bg-popover/70 backdrop-blur-[14px]"
          : "bg-popover backdrop-blur-md",
      )}
    >
      {/*
        Pinned-mode resize handle. A thin (6px) draggable strip on the LEFT
        edge of the panel. Floating expanded mode gets its own pair of
        edge handles (`ExpandedResizeHandle`) since the bar is centred and
        the user expects whichever edge they grab to follow the cursor.
       */}
      {isPinned ? <PinnedResizeHandle /> : null}
      {!isPinned && effectiveExpanded ? (
        <>
          <ExpandedResizeHandle side="right" />
          <ExpandedResizeHandle side="left" />
          <TopResizeHandle />
        </>
      ) : null}

      {effectiveExpanded ? (
        <ExpandedContent
          inputRef={inputRef}
          inputValue={inputValue}
          activePrefix={activePrefix}
          activeVerb={activeVerb}
          onPickVerb={handlePickVerb}
          activeOption={activeOption}
          onActiveOptionChange={setActiveOption}
          onInputChange={handleInputChange}
          onSelectionChange={handleSelectionChange}
          onKeyDown={handleKeyDown}
          chips={chips}
          onRemoveChip={removeChip}
          isComposing={isComposing}
          onPickSkill={handlePickSkill}
          onPickReference={handlePickReference}
          onPickReferenceOccurrence={handlePickReferenceOccurrence}
          onPickTag={handlePickTag}
          initialTagDrilldown={pendingTagDrilldown}
          initialPersonDrilldown={pendingMentionDrilldown}
          onPickTask={handlePickTask}
          onPickResearch={handlePickResearch}
          onPickPalette={handlePickPalette}
          onStreamSend={handleStreamSend}
          onStreamPrefill={handleStreamPrefill}
          onStreamResend={handleStreamResend}
          onStreamEdit={handleStreamEdit}
          editing={editContext !== null}
          onCancelEdit={clearEditContext}
          pendingAttachments={pendingAttachments}
          onRemoveAttachment={removeImageAttachment}
          onAddAttachment={addImageAttachment}
          onPickImage={handleImagePick}
          isLoading={isLoading}
          switchPending={switchPending}
          pendingProjectSwitch={Boolean(pendingProjectSwitch)}
          pendingAgentSwitch={Boolean(pendingAgentSwitch)}
          onStop={cancelChat}
          onSend={handleSend}
          chatView={chatView}
          onSelectConversation={handleSelectConversation}
          selectedProjectPaths={selectedProjectPaths}
          contextItems={contextItems}
          onDismissContext={dismissItem}
          explicitAttachOffer={explicitAttachOffer}
          onAttachExplicit={attachExplicit}
        />
      ) : (
        <CompactContent onActivate={expand} />
      )}

      {/* #127 parity — cross-provider resend/edit confirmation dialog.
       *  Rendered inside the bar so it participates in the portal (when
       *  the bar is floating-portaled) and in-flow (when pinned).
       *  `ResendProviderDialog` itself uses a Radix `AlertDialog` which
       *  portal-mounts its content, so actual placement is handled by
       *  Radix regardless of where this JSX lives.
       */}
      {resendDialogOptions && resendDialog ? (
        <ResendProviderDialog
          open={!!resendDialog}
          onOpenChange={(next) => {
            if (!next) handleResendDialogCancel();
          }}
          original={resendDialogOptions.original}
          current={resendDialogOptions.current}
          isEdit={resendDialogOptions.isEdit}
          onConfirm={handleResendDialogConfirm}
        />
      ) : null}
    </div>
  );

  if (isPinned) {
    // Pinned mode: render inline (no portal). The fixed-positioning on the
    // bar itself is what docks it to the right edge — the parent QuietLayout
    // applies a corresponding padding-right so document content doesn't
    // slide under the panel.
    return bar;
  }

  // SSR / non-browser fallback: skip the portal entirely.
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(bar, document.body);
}

// ---------------------------------------------------------------------------
// PinnedResizeHandle — vertical drag handle on the left edge of the pinned
// panel. The actual width state lives in the `--cmd-bar-pinned-width` CSS
// variable on <html>; we only persist the final value to settings-store on
// pointerup / keyup. This keeps mousemove paths free of React re-renders.
// ---------------------------------------------------------------------------

function PinnedResizeHandle() {
  const persistedWidth = useSettingsStore((s) => s.cmdBarPinnedWidth);
  const setCmdBarPinnedWidth = useSettingsStore((s) => s.setCmdBarPinnedWidth);

  // Sync the persisted width to the CSS variable on mount and whenever the
  // store value changes (e.g., on rehydration after restart).
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--cmd-bar-pinned-width",
      `${persistedWidth}px`,
    );
  }, [persistedWidth]);

  // Pointer drag — write to the CSS variable on every move, persist on up.
  // `data-cmd-bar-resizing="true"` on <html> disables the bar's
  // `transition-all duration-200` so the width tracks the cursor with
  // zero lag (live-test 2026-04-26 — see `globals.css`).
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      document.documentElement.setAttribute("data-cmd-bar-resizing", "true");

      const onMove = (moveEvent: PointerEvent) => {
        // The panel docks to the right edge, so the new width is the
        // distance from the pointer to the right edge of the viewport.
        const next = Math.round(
          Math.max(
            PINNED_WIDTH_MIN,
            Math.min(PINNED_WIDTH_MAX, window.innerWidth - moveEvent.clientX),
          ),
        );
        document.documentElement.style.setProperty(
          "--cmd-bar-pinned-width",
          `${next}px`,
        );
      };

      const onUp = (upEvent: PointerEvent) => {
        const finalWidth = Math.round(
          Math.max(
            PINNED_WIDTH_MIN,
            Math.min(PINNED_WIDTH_MAX, window.innerWidth - upEvent.clientX),
          ),
        );
        setCmdBarPinnedWidth(finalWidth);
        target.releasePointerCapture(event.pointerId);
        document.documentElement.removeAttribute("data-cmd-bar-resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setCmdBarPinnedWidth],
  );

  // Keyboard adjustment — ←/→ adjust width by ±20 px while focused. Persist
  // immediately (no need to defer; key events are coarse-grained).
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      // ArrowLeft makes the panel WIDER (it grows away from the right edge).
      const delta =
        event.key === "ArrowLeft"
          ? PINNED_WIDTH_KEYBOARD_STEP
          : -PINNED_WIDTH_KEYBOARD_STEP;
      const current = persistedWidth;
      const next = Math.max(
        PINNED_WIDTH_MIN,
        Math.min(PINNED_WIDTH_MAX, current + delta),
      );
      // Update the CSS variable immediately so the user sees the change,
      // then persist via the store setter (which will re-sync on the next
      // effect run, but this avoids any flicker).
      document.documentElement.style.setProperty(
        "--cmd-bar-pinned-width",
        `${next}px`,
      );
      setCmdBarPinnedWidth(next);
    },
    [persistedWidth, setCmdBarPinnedWidth],
  );

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Resize chat panel"
      aria-orientation="vertical"
      aria-valuemin={PINNED_WIDTH_MIN}
      aria-valuemax={PINNED_WIDTH_MAX}
      aria-valuenow={persistedWidth}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-cmd-bar-resize-handle
      className={cn(
        // Hair-thin 1px strip on the left edge: `w-px`, hover highlight,
        // generous pseudo-element hit target. Thinner-at-rest +
        // brighter-on-hover is the look the user requested
        // (live-test 2026-04-26).
        "absolute left-0 top-0 h-full w-px cursor-col-resize",
        // Invisible at rest (the bar's own border carries the edge);
        // distinctly visible on hover/focus.
        "bg-transparent hover:bg-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:bg-muted-foreground",
        // 16px-wide invisible hit target centred on the visible 1px line so
        // the comfortable click area doesn't fight the hairline aesthetic.
        "after:absolute after:inset-y-0 after:left-1/2 after:w-4 after:-translate-x-1/2",
        // Sit above the panel content so pointer events land on the handle.
        "z-10",
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// ExpandedResizeHandle — vertical drag handle on either edge of the
// floating expanded bar. The bar is horizontally centred, so width changes
// twice as fast as the cursor delta — one cursor pixel of drag moves both
// edges by one pixel, growing the width by two. This makes whichever edge
// the user grabs follow the cursor exactly.
//
// Width state lives in the `--cmd-bar-expanded-width` CSS variable on
// <html>; the React store is only written on pointerup / keyup, same as
// the pinned handle pattern.
// ---------------------------------------------------------------------------

function ExpandedResizeHandle({ side }: { side: "left" | "right" }) {
  const persistedWidth = useSettingsStore((s) => s.cmdBarExpandedWidth);
  const setCmdBarExpandedWidth = useSettingsStore((s) => s.setCmdBarExpandedWidth);

  // Sync the persisted width to the CSS variable on mount and whenever the
  // store value changes (e.g., on rehydration after restart). Both handles
  // share the same variable so this effect runs in either instance — that's
  // fine; setProperty is idempotent.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--cmd-bar-expanded-width",
      `${persistedWidth}px`,
    );
  }, [persistedWidth]);

  // `data-cmd-bar-resizing="true"` on <html> disables the bar's
  // `transition-all duration-200` so width tracks the cursor without lag.
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      document.documentElement.setAttribute("data-cmd-bar-resizing", "true");

      const startX = event.clientX;
      const startWidth = persistedWidth;
      // Right-edge drag: rightward cursor → wider; deltaWidth = +2 * deltaX
      // Left-edge drag:  leftward cursor → wider;  deltaWidth = -2 * deltaX
      const sign = side === "right" ? 1 : -1;

      const compute = (clientX: number) => {
        const deltaX = clientX - startX;
        return Math.round(
          Math.max(
            EXPANDED_WIDTH_MIN,
            Math.min(EXPANDED_WIDTH_MAX, startWidth + 2 * sign * deltaX),
          ),
        );
      };

      const onMove = (moveEvent: PointerEvent) => {
        document.documentElement.style.setProperty(
          "--cmd-bar-expanded-width",
          `${compute(moveEvent.clientX)}px`,
        );
      };

      const onUp = (upEvent: PointerEvent) => {
        setCmdBarExpandedWidth(compute(upEvent.clientX));
        target.releasePointerCapture(event.pointerId);
        document.documentElement.removeAttribute("data-cmd-bar-resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [persistedWidth, side, setCmdBarExpandedWidth],
  );

  // Keyboard adjustment — ←/→ adjust width by ±20 px while focused. Direction
  // is consistent regardless of which side handle is focused: ArrowRight
  // grows the bar, ArrowLeft shrinks it. (The pinned handle inverts because
  // its panel grows away from the right edge; the floating bar grows
  // symmetrically, so the convention is "right widens".)
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta =
        event.key === "ArrowRight"
          ? EXPANDED_WIDTH_KEYBOARD_STEP
          : -EXPANDED_WIDTH_KEYBOARD_STEP;
      const next = Math.max(
        EXPANDED_WIDTH_MIN,
        Math.min(EXPANDED_WIDTH_MAX, persistedWidth + delta),
      );
      document.documentElement.style.setProperty(
        "--cmd-bar-expanded-width",
        `${next}px`,
      );
      setCmdBarExpandedWidth(next);
    },
    [persistedWidth, setCmdBarExpandedWidth],
  );

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Resize command bar"
      aria-orientation="vertical"
      aria-valuemin={EXPANDED_WIDTH_MIN}
      aria-valuemax={EXPANDED_WIDTH_MAX}
      aria-valuenow={persistedWidth}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-cmd-bar-resize-handle
      data-cmd-bar-resize-side={side}
      className={cn(
        // Hair-thin 1px strip on the chosen edge: `w-px`, hover
        // highlight, 16px pseudo-element hit target. Thinner-at-rest +
        // brighter-on-hover (live-test 2026-04-26).
        "absolute top-0 h-full w-px cursor-col-resize",
        side === "right" ? "right-0" : "left-0",
        "bg-transparent hover:bg-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:bg-muted-foreground",
        // 16px-wide invisible hit target centred on the visible line.
        "after:absolute after:inset-y-0 after:left-1/2 after:w-4 after:-translate-x-1/2",
        "z-10",
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// TopResizeHandle — horizontal drag handle on the top edge of the floating
// expanded bar. Dragging up increases height, dragging down decreases it.
// The bar is anchored at the bottom, so the new height is the distance from
// the pointer to the bar's bottom edge.
//
// Height state lives in the `--cmd-bar-expanded-height` CSS variable on
// <html>; the React store is only written on pointerup / keyup, same as
// the width-resize handle pattern.
// ---------------------------------------------------------------------------

function TopResizeHandle() {
  const persistedHeight = useSettingsStore((s) => s.cmdBarExpandedHeight);
  const setCmdBarExpandedHeight = useSettingsStore((s) => s.setCmdBarExpandedHeight);

  // Sync the persisted height to the CSS variable on mount and whenever the
  // store value changes (e.g., on rehydration after restart).
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--cmd-bar-expanded-height",
      `${persistedHeight}px`,
    );
  }, [persistedHeight]);

  // Pointer drag — write to the CSS variable on every move, persist on up.
  // The bar is fixed bottom-10, so height = bottom_edge_y - pointer_y.
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      document.documentElement.setAttribute("data-cmd-bar-resizing", "true");

      // The bottom of the bar is at viewport_height - bottom_offset.
      // We read it once at drag-start to keep it stable during the drag.
      const barEl = target.parentElement;
      const barBottom = barEl ? barEl.getBoundingClientRect().bottom : window.innerHeight - 40;

      const compute = (clientY: number) => {
        return Math.round(
          Math.max(
            EXPANDED_HEIGHT_MIN,
            Math.min(EXPANDED_HEIGHT_MAX, barBottom - clientY),
          ),
        );
      };

      const onMove = (moveEvent: PointerEvent) => {
        document.documentElement.style.setProperty(
          "--cmd-bar-expanded-height",
          `${compute(moveEvent.clientY)}px`,
        );
      };

      const onUp = (upEvent: PointerEvent) => {
        setCmdBarExpandedHeight(compute(upEvent.clientY));
        target.releasePointerCapture(event.pointerId);
        document.documentElement.removeAttribute("data-cmd-bar-resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setCmdBarExpandedHeight],
  );

  // Keyboard adjustment — ↑/↓ adjust height by ±20 px while focused.
  // ArrowUp grows the bar, ArrowDown shrinks it.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const delta =
        event.key === "ArrowUp"
          ? EXPANDED_HEIGHT_KEYBOARD_STEP
          : -EXPANDED_HEIGHT_KEYBOARD_STEP;
      const next = Math.max(
        EXPANDED_HEIGHT_MIN,
        Math.min(EXPANDED_HEIGHT_MAX, persistedHeight + delta),
      );
      document.documentElement.style.setProperty(
        "--cmd-bar-expanded-height",
        `${next}px`,
      );
      setCmdBarExpandedHeight(next);
    },
    [persistedHeight, setCmdBarExpandedHeight],
  );

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Resize command bar height"
      aria-orientation="vertical"
      aria-valuemin={EXPANDED_HEIGHT_MIN}
      aria-valuemax={EXPANDED_HEIGHT_MAX}
      aria-valuenow={persistedHeight}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-cmd-bar-resize-handle
      className={cn(
        // Hair-thin 1px strip on the top edge — matches the edge-handle
        // rhythm (`h-px`, hover highlight, generous pseudo-element hit
        // target). Thinner-at-rest + brighter-on-hover (consistent with
        // the side handles).
        "absolute top-0 left-0 w-full h-px cursor-row-resize",
        "bg-transparent hover:bg-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:bg-muted-foreground",
        // 16px-tall invisible hit target centred on the visible 1px line.
        "after:absolute after:inset-x-0 after:top-1/2 after:h-4 after:-translate-y-1/2",
        "z-10",
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Sub-components — kept private to this module per the "one component per
// file" rule. These are pure visual fragments, not standalone components.
// ---------------------------------------------------------------------------

interface CompactContentProps {
  onActivate: () => void;
}

function CompactContent({ onActivate }: CompactContentProps) {
  // Live-test 2026-04-25 — the right-aligned `⌘K` <kbd> hint was
  // removed because COMPACT_PLACEHOLDER ("Press ⌘K to ask") on the
  // left already names the chord. Showing it twice in the same pill
  // was redundant and over-informing — the user explicitly asked us
  // to "focus on simplicity" in this batch. Centering the placeholder
  // also reads better than the previous left-justified + right-kbd
  // layout for a single-line pill.
  return (
    <button
      type="button"
      onClick={onActivate}
      className={cn(
        "flex h-full w-full items-center justify-center px-4",
        "text-left text-sm text-muted-foreground",
        "hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
    >
      <span>{COMPACT_PLACEHOLDER}</span>
    </button>
  );
}

interface ActiveOptionInfo {
  listboxId: string;
  activeOptionId: string | null;
  count: number;
}

interface ExpandedContentProps {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  inputValue: string;
  activePrefix: ActivePrefix | null;
  /**
   * Active verb-prefix detection (PRD `2026-04-28-cmd-bar-verb-prefixes`).
   * When non-null AND `verb === null`, the discovery menu renders.
   * Verbs are mutually exclusive with `activePrefix` — the parent
   * forces this to null while a single-char prefix is active.
   */
  activeVerb: ActiveVerb | null;
  /** Verb discovery menu picked a verb name — autocomplete + jump to filter. */
  onPickVerb: (verbName: string) => void;
  /**
   * Currently-highlighted option in the open mode picker, reported up by the
   * picker via `onActiveOptionChange`. Wired through to `aria-controls` /
   * `aria-activedescendant` on the combobox input below (#78).
   */
  activeOption: ActiveOptionInfo | null;
  onActiveOptionChange: (info: ActiveOptionInfo) => void;
  onInputChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSelectionChange: (event: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  chips: AttachmentChip[];
  onRemoveChip: (id: string) => void;
  isComposing: boolean;
  onPickSkill: (name: string) => void;
  onPickReference: (chip: AttachmentChip) => void;
  onPickReferenceOccurrence: (action: {
    filePath: string;
    fileName: string;
    symbol: string;
    occurrenceInFile: number;
  }) => void;
  onPickTag: (action: TagPickAction) => void;
  /** Drilldown seed forwarded to TagMode / ReferenceMode (sidebar click → level 2). */
  initialTagDrilldown?: string | null;
  initialPersonDrilldown?: string | null;
  onPickTask: (action: TaskAction) => void;
  onPickResearch: (chip: AttachmentChip) => void;
  onPickPalette: (commandId: string) => void;
  /**
   * Stream-originated send (QuickReplies, onboarding prompts). Bypasses
   * the composer input — content is sent verbatim.
   */
  onStreamSend: (content: string) => void;
  /**
   * Stream-originated prefill (empty-state onboarding prompts). Drops
   * the content into the composer input and focuses.
   */
  onStreamPrefill: (text: string) => void;
  /**
   * Per-user-message Resend button (same-provider path). Deletes the
   * message + descendants and re-sends the content.
   */
  onStreamResend: (message: ChatMessageType) => void;
  /**
   * Per-user-message Edit button — prefills the composer with the
   * message content and focuses.
   */
  onStreamEdit: (message: ChatMessageType) => void;
  /** Whether the composer is in edit mode (#127 — shows banner). */
  editing: boolean;
  /** Cancel edit mode (× on banner or Esc when banner is visible). */
  onCancelEdit: () => void;
  /** #126 — pending image attachments for the next send. */
  pendingAttachments: ImageAttachment[];
  /** #126 — remove a pending image attachment by id. */
  onRemoveAttachment: (id: string) => void;
  /** #126 — push a new image attachment (paste + drop handlers). */
  onAddAttachment: (attachment: ImageAttachment) => void;
  /** #126 — open the native image picker dialog. */
  onPickImage: () => void;
  /** #126 — whether a send is currently streaming (drives the Stop button). */
  isLoading: boolean;
  /** True while either an AgentSwitchCard or pending-project-switch
   *  prompt is awaiting the user's choice. Disables the textarea +
   *  send button. */
  switchPending: boolean;
  pendingProjectSwitch: boolean;
  pendingAgentSwitch: boolean;
  /** #126 — cancel the in-flight send. */
  onStop: () => void;
  /** #126 — fire the send pipeline (click-to-send button). */
  onSend: () => void;
  /** #118 — 'chat' shows the stream, 'history' shows past conversations. */
  chatView: "chat" | "history";
  /** #118 — select a conversation from the history list. */
  onSelectConversation: (id: string) => void;
  /** #118 — selected projects filter for ChatHistoryView. */
  selectedProjectPaths: string[];
  /** #134 — auto-attached context items (active tab, etc.). */
  contextItems: import("@/hooks/useChatContext").ContextItem[];
  /** #134 — dismiss a context item by id. */
  onDismissContext: (id: string) => void;
  /** #134 — offer to attach the active tab when it's out of scope. */
  explicitAttachOffer: import("@/hooks/useChatContext").ExplicitAttachOffer | null;
  /** #134 — accept the explicit-attach offer. */
  onAttachExplicit: (path: string, label: string) => void;
}

function ExpandedContent({
  inputRef,
  inputValue,
  activePrefix,
  activeVerb,
  onPickVerb,
  activeOption,
  onActiveOptionChange,
  onInputChange,
  onSelectionChange,
  onKeyDown,
  chips,
  onRemoveChip,
  isComposing,
  onPickSkill,
  onPickReference,
  onPickReferenceOccurrence,
  onPickTag,
  initialTagDrilldown,
  initialPersonDrilldown,
  onPickTask,
  onPickResearch,
  onPickPalette,
  onStreamSend,
  onStreamPrefill,
  onStreamResend,
  onStreamEdit,
  editing,
  onCancelEdit,
  pendingAttachments,
  onRemoveAttachment,
  onAddAttachment,
  onPickImage,
  isLoading,
  switchPending,
  pendingProjectSwitch,
  pendingAgentSwitch,
  onStop,
  onSend,
  chatView,
  onSelectConversation,
  selectedProjectPaths,
  contextItems,
  onDismissContext,
  explicitAttachOffer,
  onAttachExplicit,
}: ExpandedContentProps) {
  return (
    <div className="flex h-full flex-col">
      {/*
        Layout (top → bottom):
          - Context row (#10) — provider, projects, mode, history, pin
          - Chat stream (#12) — fills the scroll region below
          - Attachment chips (#11) — above the input
          - Mode pickers (#14–#19) — rendered when `activePrefix` is non-null
       */}
      {/* Live-test 2026-04-26 — when a prefix mode is active, the picker
          COVERS the entire area above the input box, including the
          context row (provider pill, projects, mode picker, history,
          pin, close). The user wanted a clean full-width tray while
          picking a tag/task/etc; bringing the context chrome back when
          they finish (Esc → no activePrefix). */}
      {activePrefix ? null : <CommandBarContext chatView={chatView} />}

      {activePrefix ? null : chatView === "history" ? (
        // #118 — Past-conversation list via `ChatHistoryView` — selection
        // behaviour and per-conversation metadata (date, title, message
        // count, branch count). Selecting a conversation flips back to
        // chat view via `onSelectConversation`.
        <div className="flex flex-1 flex-col min-h-0">
          <ChatHistoryView
            onSelectConversation={onSelectConversation}
            selectedProjectPaths={selectedProjectPaths}
          />
        </div>
      ) : (
        <CommandBarStream
          onSend={onStreamSend}
          onPrefill={onStreamPrefill}
          onResend={onStreamResend}
          onEdit={onStreamEdit}
        />
      )}

      {/* Live-test 2026-04-26 — `contextItems` + `explicitAttachOffer`
          used to render in their own strip ABOVE the input area's
          border-t, which made auto-attached files (e.g. test.md)
          appear OUTSIDE the input box. They're now rendered inside
          the unified attachments strip below (same div as chips +
          image thumbnails) so everything attached lives together. */}

      {/* #127 parity — edit-mode banner. Appears above the input when the
       *  user clicked Edit on a previous user message. Clicking the × or
       *  pressing Cancel abandons the edit without sending.
       */}
      {editing ? (
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-xs text-muted-foreground">Editing message</span>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="h-4 w-4 rounded flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Cancel editing"
                >
                  <X className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[220px]">
                Cancel editing
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ) : null}

      {activePrefix ? <PrefixModeBadge prefix={activePrefix} /> : null}

      {activePrefix ? (
        // Picker tray — `flex-1 min-h-0 overflow-y-auto` lets the list
        // own all the vertical space above the input box AND scroll
        // when filtered results exceed the visible height. Without
        // `overflow-y-auto` the keyboard highlight could walk past the
        // bar's bottom edge with no way to see the rest of the list
        // (live-test 2026-04-26).
        <div className="flex-1 min-h-0 overflow-y-auto" data-cmd-picker-tray>
          <ModePickerDispatch
            activePrefix={activePrefix}
            isComposing={isComposing}
            onActiveOptionChange={onActiveOptionChange}
            onPickSkill={onPickSkill}
            onPickReference={onPickReference}
            onPickReferenceOccurrence={onPickReferenceOccurrence}
            onPickTag={onPickTag}
            initialTagDrilldown={initialTagDrilldown}
            initialPersonDrilldown={initialPersonDrilldown}
            onPickTask={onPickTask}
            onPickResearch={onPickResearch}
            onPickPalette={onPickPalette}
          />
        </div>
      ) : activeVerb ? (
        // Verb-mode picker tray (PRD `2026-04-28-cmd-bar-verb-prefixes`).
        // When `verb === null` the user is in the discovery state
        // (bare `:` or unmatched partial name) — render the verb
        // discovery menu. When `verb !== null` the registered verb
        // owns the picker (FileMode lands in #8; until then the slot
        // renders empty so the bar's chrome stays sane).
        <div className="flex-1 min-h-0 overflow-y-auto" data-cmd-picker-tray>
          {activeVerb.verb === null ? (
            <VerbDiscoveryMenu
              typedName={activeVerb.typedName}
              onPick={onPickVerb}
            />
          ) : activeVerb.verb.id === 'file' ? (
            <FileMode
              filter={activeVerb.filter}
              onActiveOptionChange={onActiveOptionChange}
            />
          ) : null}
        </div>
      ) : null}

      {/* Live-test 2026-04-25 #151 — input row container. The
          `AttachmentStrip` (image thumbnails) used to render OUTSIDE
          this border-t boundary, which made it visually a sibling of
          the bar's chrome instead of part of the input area. Moving
          it inside the same border-t container groups attachments +
          input + send button as one block (AttachmentStrip → textarea
          → send).

          Paste / drag-drop handlers stay on this OUTER container so
          dropping anywhere in the attachments-or-input area attaches
          the file. */}
      <div
        className="border-t border-border flex flex-col"
        onPaste={async (event) => {
          // #126 parity — paste handler reads the first image item off
          // the clipboard and compresses it before pushing onto the strip.
          const items = event.clipboardData?.items;
          if (!items) return;
          for (const item of items) {
            if (item.kind === "file" && item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (!file) continue;
              event.preventDefault();
              try {
                const attachment = await compressImage(file, { name: file.name });
                onAddAttachment(attachment);
              } catch (err) {
                toast.error(`Failed to attach pasted image: ${err}`);
              }
            }
          }
        }}
        onDragOver={(event) => {
          // Signal the drop target for OS file drags AND for sidebar
          // file-row drags (#135). Without `preventDefault` the drop
          // event never fires.
          const types = event.dataTransfer?.types;
          if (
            types?.includes("Files") ||
            types?.includes(FILE_DRAG_MIME)
          ) {
            event.preventDefault();
          }
        }}
        onDrop={async (event) => {
          // OS file drag (Finder etc.) — accept image files.
          const files = event.dataTransfer?.files;
          if (files && files.length > 0) {
            const images = Array.from(files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (images.length > 0) {
              event.preventDefault();
              for (const file of images) {
                try {
                  const attachment = await compressImage(file, {
                    name: file.name,
                  });
                  onAddAttachment(attachment);
                } catch (err) {
                  toast.error(`Failed to attach ${file.name}: ${err}`);
                }
              }
              return;
            }
          }

          // #135 — sidebar drag-to-chat. Sidebar file rows stamp drags
          // with `FILE_DRAG_MIME` carrying the absolute file path. If
          // the path points at an image, read its bytes via tauriApi,
          // compress, and push to the attachment strip — same shape as
          // SidebarContextMenu's "Add to chat" action.
          const sidebarPath = event.dataTransfer?.getData(FILE_DRAG_MIME);
          if (sidebarPath) {
            event.preventDefault();
            const lower = sidebarPath.toLowerCase();
            const isImage = /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(lower);
            if (!isImage) return;
            try {
              const { tauriApi } = await import("@/lib/tauri");
              const bytes = await tauriApi.readBinaryFile(sidebarPath);
              const name = sidebarPath.split("/").pop() ?? "image";
              const ext = name.split(".").pop()?.toLowerCase() ?? "";
              const mimeMap: Record<string, string> = {
                jpg: "image/jpeg",
                jpeg: "image/jpeg",
                png: "image/png",
                gif: "image/gif",
                webp: "image/webp",
                bmp: "image/bmp",
                svg: "image/svg+xml",
              };
              const blob = new Blob([new Uint8Array(bytes)], {
                type: mimeMap[ext] ?? "image/png",
              });
              const attachment = await compressImage(blob, { name });
              onAddAttachment(attachment);
            } catch (err) {
              toast.error(`Failed to attach dropped file: ${err}`);
            }
          }
        }}
      >
        {/* Unified attachments strip (live-test 2026-04-26 round 7
            #151) — context items + chips + image thumbnails +
            explicit-attach offer all RENDERED INLINE in the same
            flex row so they're direct siblings inside the input
            box. NO line below — attachments and the icon row read
            as one input surface. */}
        {(contextItems.length > 0 ||
          chips.length > 0 ||
          pendingAttachments.length > 0 ||
          explicitAttachOffer) && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2 pb-1">
            {/* Context pills — auto-attached files (active tab when
                in scope). Render first so they sit on the left,
                then user-chosen chips, then image thumbnails,
                then the explicit-attach offer (if any). */}
            {contextItems.map((item) => (
              <ContextPill
                key={item.id}
                item={item}
                onDismiss={onDismissContext}
              />
            ))}
            {chips.map((chip) => {
              const Icon = CHIP_ICONS[chip.kind];
              return (
                <div
                  key={chip.id}
                  data-chip-kind={chip.kind}
                  className={cn(
                    "group inline-flex items-center gap-1.5 max-w-[200px]",
                    "rounded-md border border-border bg-muted/40",
                    "pl-1.5 pr-1 py-0.5 text-xs text-foreground",
                    "transition-colors hover:bg-muted",
                  )}
                >
                  <Icon
                    className="h-3 w-3 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <span className="truncate">{chip.name}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveChip(chip.id)}
                    aria-label={`Remove ${chip.name}`}
                    className={cn(
                      "shrink-0 rounded-sm p-0.5",
                      "text-muted-foreground hover:text-foreground hover:bg-background/60",
                      "transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    )}
                  >
                    <X
                      className="h-3 w-3"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              );
            })}
            {pendingAttachments.map((att) => (
              <TooltipProvider key={att.id} delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="relative group shrink-0 h-8 w-8 rounded-md overflow-hidden border border-border bg-muted"
                    >
                      <img
                        src={`data:${att.mimeType};base64,${att.data}`}
                        alt={att.name}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => onRemoveAttachment(att.id)}
                        aria-label={`Remove ${att.name}`}
                        className={cn(
                          "absolute top-0 right-0 rounded-bl-md bg-background/70 backdrop-blur-sm",
                          "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
                          "hover:bg-background p-px",
                        )}
                      >
                        <X className="h-2.5 w-2.5 text-foreground" strokeWidth={1.5} />
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[260px]">
                    {att.name}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
            {/* Explicit-attach offer — dashed `+ Add <file> to chat`
                button when the active tab sits outside the selected
                project scope. Sits at the END of the strip so the
                primary attachments take the leading slots. */}
            {explicitAttachOffer ? (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() =>
                        onAttachExplicit(
                          explicitAttachOffer.path,
                          explicitAttachOffer.label,
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-muted text-xs px-1.5 py-0.5 max-w-[220px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={`Add ${explicitAttachOffer.label} to chat`}
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      <span className="truncate">
                        Add {explicitAttachOffer.label} to chat
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[280px]">
                    Add {explicitAttachOffer.path} to chat (outside selected project scope)
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
        )}

        {/* Icon + textarea row — image-attach, mic, textarea, send
            ALL on one row. No internal separator above this row. */}
        <div className="px-3 py-2 flex items-end gap-2">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onPickImage}
                  aria-label="Attach image"
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                    "text-muted-foreground hover:text-foreground hover:bg-muted",
                    "transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  )}
                >
                  <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[220px]">
                Attach image
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <textarea
            ref={inputRef}
            rows={1}
            role="combobox"
            aria-label="Chat and command input"
            aria-haspopup="listbox"
            aria-expanded={Boolean(activePrefix)}
            aria-autocomplete="list"
            aria-controls={activeOption?.listboxId}
            aria-activedescendant={activeOption?.activeOptionId ?? undefined}
            value={inputValue}
            onChange={onInputChange}
            onKeyUp={onSelectionChange}
            onClick={onSelectionChange}
            onKeyDown={onKeyDown}
            disabled={switchPending}
            placeholder={
              pendingProjectSwitch
                ? "Resolve project context change first…"
                : pendingAgentSwitch
                  ? "Resolve provider change first…"
                  : "Ask, search, or type / for skills…"
            }
            className={cn(
              "flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground",
              "outline-none resize-none leading-relaxed py-0.5",
              "max-h-[160px] overflow-y-auto",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          />
          {isLoading ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onStop}
                    aria-label="Stop generation"
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                      // Neutral, not destructive: `text-foreground` is near-black in
                      // light mode and near-white in dark mode (stopping a stream is
                      // not an error/danger action). Subtle muted fill keeps the
                      // affordance shape the red version had.
                      "bg-muted text-foreground hover:bg-muted/70",
                      "transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    )}
                  >
                    <Square className="h-3 w-3 fill-current" strokeWidth={1.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[220px]">
                  Stop generation
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onSend}
                    aria-label="Send message"
                    disabled={
                      switchPending ||
                      (inputValue.trim().length === 0 &&
                        chips.length === 0 &&
                        pendingAttachments.length === 0)
                    }
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                      "bg-[var(--color-accent-primary)] text-white hover:opacity-90",
                      "transition-opacity",
                      "disabled:opacity-40 disabled:cursor-not-allowed",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    )}
                  >
                    <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[220px]">
                  Send message
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
}

interface PrefixModeBadgeProps {
  prefix: ActivePrefix;
}

/**
 * Visual indicator that a prefix mode is active. The actual mode picker
 * dropdown (file/skill/tag list, keyboard nav) is built in #14–#19; this
 * badge is just the signal that detection works and previews the mode
 * metadata until the pickers land.
 */
function PrefixModeBadge({ prefix }: PrefixModeBadgeProps) {
  return (
    <div
      data-cmd-bar-prefix-badge
      role="status"
      aria-live="polite"
      className={cn(
        "border-t border-border px-3 py-2",
        "flex items-center gap-2 text-xs text-muted-foreground",
      )}
    >
      <span className="font-medium text-foreground">{prefix.mode.label}</span>
      <span className="text-muted-foreground/70">·</span>
      <kbd className="rounded bg-muted px-1 py-px text-[11px] text-foreground">
        {prefix.mode.prefix}
      </kbd>
      <span>{prefix.mode.description}</span>
    </div>
  );
}

interface ModePickerDispatchProps {
  activePrefix: ActivePrefix;
  isComposing: boolean;
  onActiveOptionChange: (info: ActiveOptionInfo) => void;
  onPickSkill: (name: string) => void;
  onPickReference: (chip: AttachmentChip) => void;
  onPickReferenceOccurrence: (action: {
    filePath: string;
    fileName: string;
    symbol: string;
    occurrenceInFile: number;
  }) => void;
  onPickTag: (action: TagPickAction) => void;
  /** Drilldown seed forwarded to TagMode / ReferenceMode (sidebar click → level 2). */
  initialTagDrilldown?: string | null;
  initialPersonDrilldown?: string | null;
  onPickTask: (action: TaskAction) => void;
  onPickResearch: (chip: AttachmentChip) => void;
  onPickPalette: (commandId: string) => void;
}

/**
 * Stable per-mode listbox ids — used by the input's `aria-controls` and as
 * the option-id prefix every picker emits (`${listboxId}-opt-${i}`). Keeping
 * one fixed id per mode means tests and DOM queries can target a known id
 * without race conditions on `useId()` regeneration across renders.
 */
const MODE_LISTBOX_IDS: Record<string, string> = {
  skill: "cmd-skill-listbox",
  reference: "cmd-reference-listbox",
  tag: "cmd-tag-listbox",
  task: "cmd-task-listbox",
  research: "cmd-research-listbox",
  palette: "cmd-palette-listbox",
};

/**
 * Picker dispatcher — selects the mode-specific picker based on the active
 * prefix's mode id. Each picker is a standalone component (#14–#19); the
 * dispatcher is just the route table. Forwards the stable listbox id and
 * the active-option callback so the parent can mirror highlight state on
 * the combobox input via `aria-activedescendant` (#78).
 */
function ModePickerDispatch({
  activePrefix,
  isComposing,
  onActiveOptionChange,
  onPickSkill,
  onPickReference,
  onPickReferenceOccurrence,
  onPickTag,
  initialTagDrilldown,
  initialPersonDrilldown,
  onPickTask,
  onPickResearch,
  onPickPalette,
}: ModePickerDispatchProps) {
  const filter = activePrefix.filter;
  const listboxId = MODE_LISTBOX_IDS[activePrefix.mode.id];
  switch (activePrefix.mode.id) {
    case "skill":
      return (
        <SkillMode
          filter={filter}
          onPick={onPickSkill}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
    case "reference":
      return (
        <ReferenceMode
          filter={filter}
          onPick={onPickReference}
          onPickOccurrence={onPickReferenceOccurrence}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
          initialPersonDrilldown={initialPersonDrilldown ?? null}
        />
      );
    case "tag":
      return (
        <TagMode
          filter={filter}
          onPick={onPickTag}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
          initialDrilldown={initialTagDrilldown ?? null}
        />
      );
    case "task":
      return (
        <TaskMode
          filter={filter}
          onPick={onPickTask}
          isComposing={isComposing}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
    case "research":
      return (
        <ResearchMode
          filter={filter}
          onPick={onPickResearch}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
    case "palette":
      return (
        <PaletteMode
          filter={filter}
          onPick={onPickPalette}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// VerbDiscoveryMenu — bare `:` (or `:partial-name`) discovery list
// (PRD `2026-04-28-cmd-bar-verb-prefixes`). Renders every registered
// verb whose name starts with the typed partial; an empty `typedName`
// surfaces all verbs. Click / Enter on a row autocompletes to
// `:fullName ` and jumps the cursor into the filter slot (the parent
// owns that side of the wiring; this component just emits the picked
// verb name).
// ---------------------------------------------------------------------------

interface VerbDiscoveryMenuProps {
  typedName: string;
  onPick: (verbName: string) => void;
}

function VerbDiscoveryMenu({ typedName, onPick }: VerbDiscoveryMenuProps) {
  const verbs = Object.values(VERBS);
  const filtered = typedName
    ? verbs.filter((v) => v.name.startsWith(typedName))
    : verbs;

  if (filtered.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground" role="status">
        No verb command matching <span className="font-mono">:{typedName}</span>
      </div>
    );
  }

  return (
    <ul role="listbox" aria-label="Command bar verbs" className="m-0 p-0 list-none">
      {filtered.map((verb) => (
        <li key={verb.id}>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onPick(verb.name)}
            className={cn(
              "w-full text-left px-3 py-2 text-sm flex items-baseline gap-2",
              "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
            )}
          >
            <span className="font-mono text-foreground">:{verb.name}</span>
            <span className="text-xs text-muted-foreground truncate">
              {verb.description}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default FloatingCommandBar;
