import { Wrench } from 'lucide-react';
import { type McpToolInfo } from '@/stores/mcp-store';

export function ToolRow({ tool }: { tool: McpToolInfo }) {
  return (
    <div className="flex items-start gap-2 px-2 py-1 rounded text-xs">
      <Wrench className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" strokeWidth={1.5} />
      <div className="min-w-0">
        <span className="font-mono text-foreground">{tool.name}</span>
        {tool.description && (
          <p className="text-muted-foreground line-clamp-1">{tool.description}</p>
        )}
      </div>
    </div>
  );
}
