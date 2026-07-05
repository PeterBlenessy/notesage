import { ChevronDown, Zap } from 'lucide-react';
import { useState } from 'react';
import { MarkdownContent } from '@/components/MarkdownContent';
import type { ChatMessage as ChatMessageType } from '@/lib/ai/types';
import { AttachmentFileStrip, AttachmentThumbnails } from './AttachmentStrips';

export function UserContent({ message }: { message: ChatMessageType }) {
  const [skillExpanded, setSkillExpanded] = useState(false);
  const displayText = message.displayContent ?? message.content;

  if (message.skillName) {
    return (
      <div>
        <AttachmentThumbnails message={message} />
        <AttachmentFileStrip message={message} />
        <button
          onClick={() => setSkillExpanded(!skillExpanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1.5"
        >
          <Zap className="h-3 w-3" strokeWidth={1.5} />
          <ChevronDown
            className={`h-2.5 w-2.5 transition-transform duration-150 ${skillExpanded ? '' : '-rotate-90'}`}
            strokeWidth={1.5}
          />
          <span>Using skill: {message.skillName}</span>
        </button>
        {skillExpanded && (
          <div className="mb-2 max-h-40 overflow-y-auto thin-scrollbar rounded-md bg-muted/40 px-2 py-1.5">
            <MarkdownContent content={message.content} className="text-xs text-muted-foreground" />
          </div>
        )}
        <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{displayText}</p>
      </div>
    );
  }

  return (
    <div>
      <AttachmentThumbnails message={message} />
      <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{displayText}</p>
    </div>
  );
}
