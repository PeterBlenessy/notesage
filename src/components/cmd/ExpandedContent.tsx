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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { compressImage } from '@/lib/image-compress';
import { FILE_DRAG_MIME } from '@/components/sidebar/quiet/file-drag';
import CommandBarContext from '@/components/cmd/CommandBarContext';
import CommandBarStream from '@/components/cmd/CommandBarStream';
import { ChatHistoryView } from '@/components/chat/ChatHistoryView';
import { ContextPill } from '@/components/chat/ContextPill';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import FileMode from '@/components/cmd/modes/FileMode';
import { PrefixModeBadge } from '@/components/cmd/PrefixModeBadge';
import { ModePickerDispatch, type ActiveOptionInfo } from '@/components/cmd/ModePickerDispatch';
import type { TagPickAction } from '@/components/cmd/modes/TagMode';
import type { TaskAction } from '@/components/cmd/modes/TaskMode';
import { VerbDiscoveryMenu } from '@/components/cmd/VerbDiscoveryMenu';
import type { AttachmentChip } from '@/components/cmd/AttachmentChips';
import type { ActivePrefix } from '@/components/cmd/prefix-modes';
import type { ActiveVerb } from '@/components/cmd/verb-modes';
import type { ChatMessage as ChatMessageType, ImageAttachment } from '@/lib/ai/types';
import type { ContextItem, ExplicitAttachOffer } from '@/hooks/useChatContext';

export type { ActiveOptionInfo, TagPickAction, TaskAction };

// Inline chip icon map — chips render as direct flex siblings of image
// thumbnails (guaranteed left-to-right ordering by DOM position).
const CHIP_ICONS: Record<AttachmentChip['kind'], LucideIcon> = {
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
  activeVerb: ActiveVerb | null;
  onPickVerb: (verbName: string) => void;
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
  initialTagDrilldown?: string | null;
  initialPersonDrilldown?: string | null;
  onPickTask: (action: TaskAction) => void;
  onPickResearch: (chip: AttachmentChip) => void;
  onPickPalette: (commandId: string) => void;
  onStreamSend: (content: string) => void;
  onStreamPrefill: (text: string) => void;
  onStreamResend: (message: ChatMessageType) => void;
  onStreamEdit: (message: ChatMessageType) => void;
  editing: boolean;
  onCancelEdit: () => void;
  pendingAttachments: ImageAttachment[];
  onRemoveAttachment: (id: string) => void;
  onAddAttachment: (attachment: ImageAttachment) => void;
  onPickImage: () => void;
  isLoading: boolean;
  switchPending: boolean;
  pendingProjectSwitch: boolean;
  pendingAgentSwitch: boolean;
  onStop: () => void;
  onSend: () => void;
  chatView: 'chat' | 'history';
  onSelectConversation: (id: string) => void;
  selectedProjectPaths: string[];
  contextItems: ContextItem[];
  onDismissContext: (id: string) => void;
  explicitAttachOffer: ExplicitAttachOffer | null;
  onAttachExplicit: (path: string, label: string) => void;
}

/**
 * Expanded state content of the FloatingCommandBar — the full composer layout
 * with context row, chat stream, attachment chips, mode pickers, input, and
 * send / stop controls.
 */
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
      {/* When a prefix mode is active, the picker COVERS the entire area above
          the input box, including the context row. */}
      {activePrefix ? null : <CommandBarContext chatView={chatView} />}

      {activePrefix ? null : chatView === 'history' ? (
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

      {/* Edit-mode banner */}
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

      {/* Input row container — paste/drop handlers attach here so dropping
          anywhere in the attachments-or-input area attaches the file. */}
      <div
        className="border-t border-border flex flex-col"
        onPaste={async (event) => {
          const items = event.clipboardData?.items;
          if (!items) return;
          for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
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
          const types = event.dataTransfer?.types;
          if (
            types?.includes('Files') ||
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
              f.type.startsWith('image/'),
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

          // Sidebar drag-to-chat.
          const sidebarPath = event.dataTransfer?.getData(FILE_DRAG_MIME);
          if (sidebarPath) {
            event.preventDefault();
            const lower = sidebarPath.toLowerCase();
            const isImage = /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(lower);
            if (!isImage) return;
            try {
              const { tauriApi } = await import('@/lib/tauri');
              const bytes = await tauriApi.readBinaryFile(sidebarPath);
              const name = sidebarPath.split('/').pop() ?? 'image';
              const ext = name.split('.').pop()?.toLowerCase() ?? '';
              const mimeMap: Record<string, string> = {
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                png: 'image/png',
                gif: 'image/gif',
                webp: 'image/webp',
                bmp: 'image/bmp',
                svg: 'image/svg+xml',
              };
              const blob = new Blob([new Uint8Array(bytes)], {
                type: mimeMap[ext] ?? 'image/png',
              });
              const attachment = await compressImage(blob, { name });
              onAddAttachment(attachment);
            } catch (err) {
              toast.error(`Failed to attach dropped file: ${err}`);
            }
          }
        }}
      >
        {/* Unified attachments strip — context items + chips + image thumbnails */}
        {(contextItems.length > 0 ||
          chips.length > 0 ||
          pendingAttachments.length > 0 ||
          explicitAttachOffer) && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2 pb-1">
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
                    'group inline-flex items-center gap-1.5 max-w-[200px]',
                    'rounded-md border border-border bg-muted/40',
                    'pl-1.5 pr-1 py-0.5 text-xs text-foreground',
                    'transition-colors hover:bg-muted',
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
                      'shrink-0 rounded-sm p-0.5',
                      'text-muted-foreground hover:text-foreground hover:bg-background/60',
                      'transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
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
                          'absolute top-0 right-0 rounded-bl-md bg-background/70 backdrop-blur-sm',
                          'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
                          'hover:bg-background p-px',
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

        {/* Icon + textarea row */}
        <div className="px-3 py-2 flex items-end gap-2">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onPickImage}
                  aria-label="Attach image"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                    'text-muted-foreground hover:text-foreground hover:bg-muted',
                    'transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
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
                ? 'Resolve project context change first…'
                : pendingAgentSwitch
                  ? 'Resolve provider change first…'
                  : 'Ask, search, or type / for skills…'
            }
            className={cn(
              'flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground',
              'outline-none resize-none leading-relaxed py-0.5',
              'max-h-[160px] overflow-y-auto',
              'disabled:cursor-not-allowed disabled:opacity-60',
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
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                      'bg-destructive/10 text-destructive hover:bg-destructive/20',
                      'transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40',
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
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                      'bg-[var(--color-accent-primary)] text-white hover:opacity-90',
                      'transition-opacity',
                      'disabled:opacity-40 disabled:cursor-not-allowed',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
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
