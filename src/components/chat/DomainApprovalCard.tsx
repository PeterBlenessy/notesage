import { useState, useEffect, useRef } from 'react';
import { Globe, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { tauriApi, type DomainDecision } from '@/lib/tauri';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePermissionStore } from '@/stores/permission-store';
import { useChatStore } from '@/stores/chat-store';
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

export interface DomainApprovalRequest {
  instanceId: string;
  agentId: string;
  domain: string;
  port: number;
  requestId: string;
  connectionId: string;
}

interface DomainApprovalCardProps {
  request: DomainApprovalRequest;
  onResolved: (requestId: string) => void;
}

export function DomainApprovalCard({ request, onResolved }: DomainApprovalCardProps) {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const [resolved, setResolved] = useState<string | null>(null);
  const resolvedRef = useRef(false);
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  // Auto-deny after 30s if user doesn't respond
  // Uses refs to avoid resetting the timer on parent re-renders
  useEffect(() => {
    const timer = setTimeout(() => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      tauriApi.networkDomainRespond(request.instanceId, request.requestId, 'deny').catch(() => {});
      useChatStore.getState().addMessage({
        role: 'assistant',
        content: `Network request to ${request.domain} timed out — denied.`,
      });
      setResolved(`Timed out — ${request.domain}`);
      setTimeout(() => onResolvedRef.current(request.requestId), 1500);
    }, 30000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId]);

  const respond = (decision: DomainDecision) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    tauriApi.networkDomainRespond(request.instanceId, request.requestId, decision).catch((err) => {
      toast.error(`Failed to respond to network request: ${err}`);
    });
  };

  const handleAllow = () => {
    respond('allow_once');
    setResolved(`Allowed ${request.domain} once`);
    setTimeout(() => onResolved(request.requestId), 2000);
  };

  const handleAllowSession = () => {
    respond('allow_session');
    usePermissionStore.getState().allowDomain(request.connectionId, request.domain, 'session', null);
    setResolved(`Allowed ${request.domain} for session`);
    setTimeout(() => onResolved(request.requestId), 2000);
  };

  const handleAllowAlways = () => {
    respond('allow_always');
    usePermissionStore.getState().allowDomain(request.connectionId, request.domain, 'always', null);
    setResolved(`Allowed ${request.domain} always`);
    setTimeout(() => onResolved(request.requestId), 2000);
  };

  const handleDeny = () => {
    respond('deny');
    useChatStore.getState().addMessage({
      role: 'assistant',
      content: `Network request to ${request.domain} was denied.`,
    });
    setResolved(`Denied ${request.domain}`);
    setTimeout(() => onResolved(request.requestId), 2000);
  };

  if (resolved) {
    return (
      <div className="rounded-lg border border-border bg-card/50 px-3 py-2 flex items-center gap-2.5">
        <Globe className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-[11px] text-muted-foreground">{resolved}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 flex items-start gap-2.5">
      <Globe className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">{t("chat.networkRequest")}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {request.agentId} wants to connect to <span className="font-mono">{request.domain}:{request.port}</span>
        </p>
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
