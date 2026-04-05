import { X } from 'lucide-react';
import type { ImageAttachment } from '@/lib/ai/types';

interface AttachmentStripProps {
  attachments: ImageAttachment[];
  onRemove: (id: string) => void;
}

export function AttachmentStrip({ attachments, onRemove }: AttachmentStripProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex gap-2 px-3 py-2">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="relative group shrink-0 w-12 h-12 rounded-md overflow-hidden border border-border bg-muted"
        >
          <img
            src={`data:${att.mimeType};base64,${att.data}`}
            alt={att.name ?? 'Attachment'}
            className="w-full h-full object-cover"
          />
          <button
            onClick={() => onRemove(att.id)}
            className="absolute top-0.5 right-0.5 rounded-sm bg-background/70 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:bg-background p-px"
            aria-label="Remove attachment"
          >
            <X className="h-3 w-3 text-foreground" strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  );
}
