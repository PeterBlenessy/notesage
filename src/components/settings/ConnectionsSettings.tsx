import { useState, useCallback } from 'react';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { ConnectionCard } from './ConnectionCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Plus, Check, Eye, EyeOff, Clock, Github } from 'lucide-react';
import type { Connection, ProviderOption } from '@/lib/ai/connections';
import { PROVIDER_OPTIONS, CAPABILITY_LABELS } from '@/lib/ai/connections';

const PROVIDER_LOGOS: Record<string, string | null> = {
  anthropic: '/logos/anthropic.svg',
  openai: '/logos/openai.svg',
  ollama: '/logos/ollama-official.png',
  github: null,
};

type AddFlowState =
  | { step: 'pick' }
  | { step: 'configure'; option: ProviderOption }
  | { step: 'coming_soon'; option: ProviderOption };

export function ConnectionsSettings() {
  const connections = useConnectionsStore((s) => s.connections);
  const addConnection = useConnectionsStore((s) => s.addConnection);
  const removeConnection = useConnectionsStore((s) => s.removeConnection);
  const clearRoutingForConnection = useRoutingStore((s) => s.clearRoutingForConnection);
  const autoAssign = useRoutingStore((s) => s.autoAssign);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [flow, setFlow] = useState<AddFlowState>({ step: 'pick' });
  const [inputValue, setInputValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const resetFlow = useCallback(() => {
    setFlow({ step: 'pick' });
    setInputValue('');
    setShowKey(false);
    setSavedFlash(false);
  }, []);

  const handlePopoverChange = useCallback(
    (open: boolean) => {
      setPopoverOpen(open);
      if (!open) resetFlow();
    },
    [resetFlow]
  );

  const handlePickProvider = useCallback((option: ProviderOption) => {
    if (option.authMethod === 'agent_managed') {
      setFlow({ step: 'coming_soon', option });
    } else {
      setFlow({ step: 'configure', option });
    }
  }, []);

  const handleSave = useCallback(() => {
    if (flow.step !== 'configure') return;
    const { option } = flow;

    const value = inputValue.trim();
    if (!value) return;

    let connectionId: string;
    if (option.authMethod === 'api_key') {
      connectionId = addConnection({
        provider: option.provider,
        authMethod: 'api_key',
        status: 'connected',
        label: option.label,
        credentials: { type: 'api_key', key: value },
      });
    } else {
      // local (Ollama)
      connectionId = addConnection({
        provider: option.provider,
        authMethod: 'local',
        status: 'connected',
        label: option.label,
        credentials: { type: 'local', url: value },
      });
    }

    autoAssign(connectionId);
    setSavedFlash(true);
    setTimeout(() => {
      setPopoverOpen(false);
      resetFlow();
    }, 600);
  }, [flow, inputValue, addConnection, autoAssign, resetFlow]);

  const handleDisconnect = useCallback(
    (connection: Connection) => {
      clearRoutingForConnection(connection.id);
      removeConnection(connection.id);
    },
    [clearRoutingForConnection, removeConnection]
  );

  return (
    <div className="space-y-6">
      {/* Header + Add button */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label className="text-sm font-semibold">Connections</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Manage your AI provider connections
          </p>
        </div>

        <Popover open={popoverOpen} onOpenChange={handlePopoverChange}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0">
              <Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
              Add Connection
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            {flow.step === 'pick' && (
              <ProviderPicker onPick={handlePickProvider} />
            )}
            {flow.step === 'configure' && (
              <ConfigureForm
                option={flow.option}
                value={inputValue}
                onChange={setInputValue}
                showKey={showKey}
                onToggleShow={() => setShowKey(!showKey)}
                onSave={handleSave}
                savedFlash={savedFlash}
              />
            )}
            {flow.step === 'coming_soon' && (
              <ComingSoon
                option={flow.option}
                onBack={() => setFlow({ step: 'pick' })}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Connection list */}
      {connections.length > 0 ? (
        <div className="space-y-2">
          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              connection={conn}
              onDisconnect={handleDisconnect}
            />
          ))}
        </div>
      ) : (
        <div className="p-8 text-center border border-dashed border-border rounded-lg">
          <div className="h-12 w-12 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
            <Plus className="h-6 w-6 text-muted-foreground/50" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-muted-foreground">
            No connections yet. Add a provider to get started.
          </p>
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function ProviderLogo({ provider, className = 'w-6 h-6' }: { provider: string; className?: string }) {
  const src = PROVIDER_LOGOS[provider];
  if (!src) {
    if (provider === 'github') {
      return (
        <span className={`${className} rounded flex items-center justify-center bg-white p-0.5`}>
          <Github className="w-5 h-5 text-black" strokeWidth={1.5} />
        </span>
      );
    }
    return <span className={`${className} rounded bg-muted`} />;
  }
  return (
    <img
      src={src}
      alt={provider}
      className={`${className} rounded object-contain bg-white p-0.5`}
    />
  );
}

function ProviderPicker({ onPick }: { onPick: (option: ProviderOption) => void }) {
  return (
    <div className="py-1">
      <div className="px-3 py-2 border-b border-border">
        <p className="text-sm font-medium">Add a provider</p>
        <p className="text-xs text-muted-foreground">
          Choose how you want to connect
        </p>
      </div>
      <div className="py-1">
        {PROVIDER_OPTIONS.map((option) => (
          <button
            key={`${option.provider}-${option.authMethod}`}
            onClick={() => onPick(option)}
            className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors duration-150"
          >
            <ProviderLogo provider={option.provider} className="w-6 h-6 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{option.label}</span>
                {option.authMethod === 'agent_managed' && (
                  <Clock className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {option.description}
              </p>
              <div className="flex items-center gap-1.5 mt-1.5">
                {option.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground"
                  >
                    {CAPABILITY_LABELS[cap]}
                  </span>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ConfigureForm({
  option,
  value,
  onChange,
  showKey,
  onToggleShow,
  onSave,
  savedFlash,
}: {
  option: ProviderOption;
  value: string;
  onChange: (v: string) => void;
  showKey: boolean;
  onToggleShow: () => void;
  onSave: () => void;
  savedFlash: boolean;
}) {
  const isApiKey = option.authMethod === 'api_key';

  const placeholder = isApiKey
    ? option.provider === 'anthropic'
      ? 'sk-ant-...'
      : 'sk-...'
    : 'http://localhost:11434';

  const helpText = isApiKey
    ? option.provider === 'anthropic'
      ? 'Get your key from console.anthropic.com'
      : 'Get your key from platform.openai.com'
    : 'Default: http://localhost:11434';

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <ProviderLogo provider={option.provider} className="w-5 h-5 shrink-0" />
        <span className="text-sm font-medium">{option.label}</span>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          {isApiKey ? 'API Key' : 'Server URL'}
        </Label>
        <p className="text-xs text-muted-foreground">{helpText}</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={isApiKey && !showKey ? 'password' : 'text'}
              placeholder={placeholder}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }}
              className="font-mono text-sm pr-9"
              autoFocus
            />
            {isApiKey && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full w-9 text-muted-foreground hover:text-foreground"
                onClick={onToggleShow}
                tabIndex={-1}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            )}
          </div>
          <Button onClick={onSave} size="sm" disabled={!value.trim()}>
            <Check
              className={`h-4 w-4 mr-1 transition-colors ${savedFlash ? 'text-green-500' : ''}`}
            />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function ComingSoon({
  option,
  onBack,
}: {
  option: ProviderOption;
  onBack: () => void;
}) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ProviderLogo provider={option.provider} className="w-5 h-5 shrink-0" />
        <span className="text-sm font-medium">{option.label}</span>
      </div>

      <div className="p-3 rounded-lg bg-muted/50 border border-border">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-sm font-medium">Coming soon</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Subscription-based authentication via ACP is under development.
          In the meantime, you can use an API key if available for this provider.
        </p>
      </div>

      <Button variant="ghost" size="sm" onClick={onBack} className="w-full">
        Back to providers
      </Button>
    </div>
  );
}
