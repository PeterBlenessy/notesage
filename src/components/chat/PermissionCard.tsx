import { FileEdit, Pencil, Terminal, Shield, ChevronDown } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';
import { useChatStore } from '@/stores/chat-store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePermissionStore, type PermissionRequest } from '@/stores/permission-store';
import { formatAcpToolName } from '@/hooks/useAIOperations';

function getToolIcon(kind: string) {
  switch (kind) {
    case 'write':
    case 'write_file':
      return FileEdit;
    case 'edit':
      return Pencil;
    case 'bash':
    case 'terminal':
      return Terminal;
    default:
      return Shield;
  }
}

interface PermissionCardProps {
  request: PermissionRequest;
}

export function PermissionCard({ request }: PermissionCardProps) {
  const removeRequest = usePermissionStore((s) => s.removeRequest);
  const Icon = getToolIcon(request.toolKind);
  const label = formatAcpToolName(request.toolKind, request.toolTitle);

  const approveRequest = (req: PermissionRequest) => {
    const firstOptionId = req.options.length > 0 ? req.options[0].optionId : null;
    invoke('acp_permission_respond', {
      instanceId: req.instanceId,
      requestId: req.requestId,
      optionId: firstOptionId,
    }).catch((err) => log.warn('ai', 'Failed to send permission approval', err));
    removeRequest(req.requestId);
  };

  const handleAllow = () => {
    approveRequest(request);
  };

  const handleAllowSession = () => {
    const store = usePermissionStore.getState();
    store.allowSession(request.toolKind);
    // Approve this request + any other pending requests of the same kind
    const pending = store.requests.filter((r) => r.toolKind === request.toolKind);
    for (const req of pending) {
      approveRequest(req);
    }
  };

  const handleAllowAlways = () => {
    const store = usePermissionStore.getState();
    store.allowAlways(request.toolKind, null, null);
    // Approve this request + any other pending requests of the same kind
    const pending = store.requests.filter((r) => r.toolKind === request.toolKind);
    for (const req of pending) {
      approveRequest(req);
    }
  };

  const handleDeny = () => {
    invoke('acp_permission_respond', {
      instanceId: request.instanceId,
      requestId: request.requestId,
      optionId: null,
    }).catch((err) => log.warn('ai', 'Failed to send permission denial', err));
    useChatStore.getState().addMessage({
      role: 'assistant',
      content: `Tool call "${label}" was denied.`,
    });
    removeRequest(request.requestId);
  };

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 flex items-start gap-2.5">
      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {request.toolInput && (
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{request.toolInput}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button variant="ghost" size="xs" onClick={handleDeny}>
          Deny
        </Button>
        <div className="flex items-center">
          <Button
            variant="default"
            size="xs"
            className="rounded-r-none"
            onClick={handleAllow}
          >
            Allow
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="default"
                size="xs"
                className="rounded-l-none border-l border-l-primary-foreground/20 px-1"
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onClick={handleAllow}>
                Allow once
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAllowSession}>
                Allow for this session
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAllowAlways}>
                Allow always
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
