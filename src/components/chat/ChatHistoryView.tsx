import { memo } from 'react';
import { Trash2, MessageSquare, Clock, Download } from 'lucide-react';
import { useChatStore, type Conversation } from '@/stores/chat-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';

interface ChatHistoryViewProps {
  onSelectConversation: (id: string) => void;
}

export const ChatHistoryView = memo(function ChatHistoryView({ onSelectConversation }: ChatHistoryViewProps) {
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const handleExportConversation = (conv: Conversation, format: 'markdown' | 'json') => {
    let content: string;
    let filename: string;
    const title = conv.title || 'conversation';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 40);

    if (format === 'markdown') {
      const lines = [`# ${title}`, ''];
      for (const msg of conv.messages) {
        const role = msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'Assistant';
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
        lines.push(`## ${role}${time ? ` — ${time}` : ''}`, '', msg.content, '');
      }
      content = lines.join('\n');
      filename = `${slug}.md`;
    } else {
      content = JSON.stringify({
        title: conv.title,
        createdAt: new Date(conv.createdAt).toISOString(),
        updatedAt: new Date(conv.updatedAt).toISOString(),
        messages: conv.messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
        })),
      }, null, 2);
      filename = `${slug}.json`;
    }

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
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {conversations.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          No conversations yet
        </div>
      ) : (
        <div className="divide-y divide-border">
          {[...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map((conv) => (
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
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground active:opacity-75"
                      title="Export conversation"
                    >
                      <Download className="h-3 w-3" strokeWidth={1.5} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[140px]">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleExportConversation(conv, 'markdown'); }}>
                      Export as Markdown
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleExportConversation(conv, 'json'); }}>
                      Export as JSON
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive active:opacity-75"
                  title="Delete conversation"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
