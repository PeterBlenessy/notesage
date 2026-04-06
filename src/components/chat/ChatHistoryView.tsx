import { memo } from 'react';
import { Trash2, MessageSquare, Clock, Download, GitBranch } from 'lucide-react';
import { useChatStore, type Conversation } from '@/stores/chat-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import { getThread, getLeaves } from '@/lib/chat-tree';
import type { ChatMessage } from '@/lib/ai/types';

interface ChatHistoryViewProps {
  onSelectConversation: (id: string) => void;
}

function formatMessagesAsMarkdown(messages: ChatMessage[]): string[] {
  const lines: string[] = [];
  for (const msg of messages) {
    // Skip system-status messages (reconnection UI) from exports
    if (msg.role === 'system-status') continue;
    const role = msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'Assistant';
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
    lines.push(`## ${role}${time ? ` — ${time}` : ''}`, '');

    if (msg.segments && msg.segments.length > 0) {
      // Render segments chronologically
      for (const seg of msg.segments) {
        switch (seg.type) {
          case 'text':
            lines.push(seg.content, '');
            break;
          case 'thinking':
            lines.push(`> *Thinking:* ${seg.content}`, '');
            break;
          case 'tool_call':
            lines.push(`> **[${seg.label}]**${seg.detail ? ` ${seg.detail}` : ''}`, '');
            break;
          case 'tool_result':
            if (seg.error) {
              lines.push(`> > Error: ${seg.error}`, '');
            } else if (seg.result) {
              const truncated = seg.result.length > 500
                ? seg.result.slice(0, 500) + '\u2026'
                : seg.result;
              lines.push(`> > ${truncated.replace(/\n/g, '\n> > ')}`, '');
            }
            break;
          case 'image':
            lines.push(`![${seg.alt || 'image'}](data:${seg.mimeType};base64,${seg.data})`, '');
            break;
        }
      }
    } else {
      // Old messages without segments: export content as-is
      lines.push(msg.content, '');
    }
  }
  return lines;
}

function getBranchCount(conv: Conversation): number {
  if (conv.messages.length === 0) return 0;
  const leaves = getLeaves(conv.messages);
  return leaves.length;
}

function saveExport(content: string, filename: string, format: 'markdown' | 'json') {
  import('@tauri-apps/plugin-dialog').then(async ({ save }) => {
    const filePath = await save({
      defaultPath: filename,
      filters: format === 'markdown'
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return;
    await tauriApi.writeFile(filePath, content);
    toast.success(`Exported to ${filePath.split('/').pop()}`, {
      action: {
        label: 'Reveal',
        onClick: () => tauriApi.revealInFinder(filePath),
      },
    });
  }).catch((err) => {
    toast.error(`Export failed: ${err}`);
  });
}

export const ChatHistoryView = memo(function ChatHistoryView({ onSelectConversation }: ChatHistoryViewProps) {
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const handleExportMarkdown = (conv: Conversation) => {
    const title = conv.title || 'conversation';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 40);

    // Export only the active thread
    const thread = conv.activeLeafId
      ? getThread(conv.messages, conv.activeLeafId)
      : conv.messages;

    const lines = [`# ${title}`, ''];
    lines.push(...formatMessagesAsMarkdown(thread));
    const content = lines.join('\n');
    saveExport(content, `${slug}.md`, 'markdown');
  };

  const handleExportAllBranchesMarkdown = (conv: Conversation) => {
    const title = conv.title || 'conversation';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 40);

    const leaves = getLeaves(conv.messages);
    const lines = [`# ${title}`, ''];

    if (leaves.length <= 1) {
      // Single thread or no messages — export linearly
      const thread = conv.activeLeafId
        ? getThread(conv.messages, conv.activeLeafId)
        : conv.messages;
      lines.push(...formatMessagesAsMarkdown(thread));
    } else {
      // Multiple branches — export each with a header
      leaves.forEach((leaf, index) => {
        if (index > 0) {
          lines.push('---', '');
        }
        const isActive = leaf.id === conv.activeLeafId;
        const branchLabel = `### Branch ${index + 1}${isActive ? ' (active)' : ''}`;
        lines.push(branchLabel, '');

        const thread = getThread(conv.messages, leaf.id ?? null);
        lines.push(...formatMessagesAsMarkdown(thread));
      });
    }

    const content = lines.join('\n');
    saveExport(content, `${slug}-all-branches.md`, 'markdown');
  };

  const handleExportJson = (conv: Conversation) => {
    const title = conv.title || 'conversation';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 40);

    const content = JSON.stringify({
      title: conv.title,
      createdAt: new Date(conv.createdAt).toISOString(),
      updatedAt: new Date(conv.updatedAt).toISOString(),
      activeLeafId: conv.activeLeafId ?? null,
      messages: conv.messages.filter((m) => m.role !== 'system-status').map((m) => ({
        id: m.id ?? null,
        parentId: m.parentId ?? null,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
        ...(m.segments && m.segments.length > 0 ? { segments: m.segments } : {}),
      })),
    }, null, 2);

    saveExport(content, `${slug}.json`, 'json');
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {conversations.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          No conversations yet
        </div>
      ) : (
        <div className="divide-y divide-border">
          {[...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map((conv) => {
            const branchCount = getBranchCount(conv);
            return (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectConversation(conv.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { onSelectConversation(conv.id); } }}
                className={`group flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-accent/50 ${
                  conv.id === activeConversationId ? 'bg-accent/30' : ''
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.5} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{conv.title || 'New Chat'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" strokeWidth={1.5} />
                      {new Date(conv.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      {' '}
                      {new Date(conv.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {conv.messages.length} message{conv.messages.length !== 1 ? 's' : ''}
                    </span>
                    {branchCount > 1 && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <GitBranch className="h-2.5 w-2.5" strokeWidth={1.5} />
                        {branchCount} branch{branchCount !== 1 ? 'es' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity mr-[-6px]">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:opacity-75"
                        title="Export conversation"
                      >
                        <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px]">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleExportMarkdown(conv); }}>
                        Export as Markdown
                      </DropdownMenuItem>
                      {branchCount > 1 && (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleExportAllBranchesMarkdown(conv); }}>
                          Export all branches (Markdown)
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleExportJson(conv); }}>
                        Export as JSON
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors active:opacity-75"
                    title="Delete conversation"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
