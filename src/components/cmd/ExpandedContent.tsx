import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowUp,
  BookOpen,
  CheckSquare,
  Clock,
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
import type { ChatMessage as ChatMessageType, ImageAttachment } from "@/lib/ai/types";
import type { QueuedMessage } from "@/stores/message-queue-store";
import { compressImage } from "@/lib/image-compress";
import { ChatHistoryView } from "@/components/chat/ChatHistoryView";
import { ContextPill } from "@/components/chat/ContextPill";
import { FILE_DRAG_MIME } from "@/components/sidebar/quiet/file-drag";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type AttachmentChip } from "@/components/cmd/AttachmentChips";
import CommandBarContext from "@/components/cmd/CommandBarContext";
import CommandBarStream from "@/components/cmd/CommandBarStream";
import { type ActivePrefix } from "@/components/cmd/prefix-modes";
import { type ActiveVerb } from "@/components/cmd/verb-modes";
import { type TagPickAction } from "@/components/cmd/modes/TagMode";
import { type TaskAction } from "@/components/cmd/modes/TaskMode";
import FileMode from "@/components/cmd/modes/FileMode";
import ModePickerDispatch, {
  type ActiveOptionInfo,
} from "@/components/cmd/ModePickerDispatch";
import PrefixModeBadge from "@/components/cmd/PrefixModeBadge";
import VerbDiscoveryMenu from "@/components/cmd/VerbDiscoveryMenu";

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

export interface ExpandedContentProps {
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
  /** Messages queued behind the watched conversation's in-flight run
   *  (queue-during-agent-work). Rendered as a strip above the input. */
  queuedMessages?: QueuedMessage[];
  /** Remove a queued message by id before it dispatches (strip × button). */
  onRemoveQueued?: (id: string) => void;
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

export function ExpandedContent({
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
  queuedMessages,
  onRemoveQueued,
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

      {/* Queued-message strip (queue-during-agent-work). Messages sent while
          the watched conversation's run was in flight park here until the run
          finishes — each row shows the queued text with a × to withdraw it
          before dispatch. Hidden while a prefix picker owns the tray. */}
      {!activePrefix && queuedMessages && queuedMessages.length > 0 ? (
        <div
          data-queued-messages
          className="border-t border-border px-3 py-1.5 flex flex-col gap-1"
        >
          {queuedMessages.map((message) => (
            <div
              key={message.id}
              className="flex items-center gap-1.5 min-w-0 text-xs text-muted-foreground"
            >
              <Clock
                className="h-3 w-3 shrink-0"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="flex-1 truncate">
                {message.opts?.displayContent ?? message.content}
              </span>
              <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium">
                Queued
              </span>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onRemoveQueued?.(message.id)}
                      aria-label="Remove queued message"
                      className={cn(
                        "shrink-0 rounded-sm p-0.5",
                        "text-muted-foreground hover:text-foreground hover:bg-muted",
                        "transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                      )}
                    >
                      <X className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[220px]">
                    Remove queued message
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          ))}
        </div>
      ) : null}

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

      {/* Live-test 2026-04-25 #151 — input row container. Attachment
          thumbnails render INSIDE this border-t boundary so attachments +
          input + send button group as one block (attachments → textarea
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
                  : isLoading
                    ? "Working — messages queue until it finishes…"
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

export default ExpandedContent;
