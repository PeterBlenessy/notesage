import { Paperclip } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ChatMessage as ChatMessageType } from '@/lib/ai/types';

/**
 * Compact pinned list of file-path attachments logged at send time (task #30).
 * Renders once per user message, above the user-typed text. Uses the basename
 * as the visible label with the full path on hover (native `title`) so the
 * user can audit exactly what filesystem paths were shared with the provider.
 */
export function AttachmentFileStrip({ message }: { message: ChatMessageType }) {
  const attachments = (message.activities ?? []).filter((a) => a.kind === 'attachment');
  if (attachments.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {attachments.map((a, i) => (
        <TooltipProvider key={`${a.timestamp}-${i}`} delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <Paperclip className="h-2.5 w-2.5 shrink-0" strokeWidth={1.5} />
                <span className="truncate max-w-[180px]">{a.label}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[260px]">
              {a.detail ?? a.label}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}

export function AttachmentThumbnails({ message }: { message: ChatMessageType }) {
  if (!message.attachments || message.attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {message.attachments.map((att) => (
        <TooltipProvider key={att.id} delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="block rounded-md overflow-hidden border border-border hover:border-foreground/30 transition-colors duration-150 cursor-pointer"
                onClick={() => {
                  // Build the preview window via DOM APIs rather than a
                  // string-interpolated document.write — `mimeType`/`data` are
                  // app-controlled today, but constructing the element avoids
                  // any attribute-context breakout if that ever changes
                  // (security audit LOW).
                  const win = window.open('', '_blank');
                  if (win) {
                    win.document.title = att.name ?? 'Image';
                    const img = win.document.createElement('img');
                    img.src = `data:${att.mimeType};base64,${att.data}`;
                    img.alt = att.name ?? 'Image';
                    img.style.maxWidth = '100%';
                    img.style.height = 'auto';
                    win.document.body.appendChild(img);
                  }
                }}
                aria-label={att.name ?? 'View attached image full size'}
              >
                <img
                  src={`data:${att.mimeType};base64,${att.data}`}
                  alt={att.name ?? 'Attached image'}
                  className="max-w-[120px] max-h-[120px] object-contain"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[260px]">
              {att.name ?? 'Click to view full size'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}
