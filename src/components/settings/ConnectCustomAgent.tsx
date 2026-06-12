import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  Plus,
  X,
} from 'lucide-react';
import { ProviderLogo } from '@/components/ProviderLogo';
import { tauriApi } from '@/lib/tauri';
import {
  registerCustomAcpConnection,
} from '@/lib/ai/acp-agent-state';
import type { AcpDiscoveredCapabilities } from '@/lib/ai/connections';

type Phase = 'form' | 'probing' | 'success';

interface EnvRow {
  id: number;
  name: string;
  value: string;
  show: boolean;
}

/**
 * Add Connection form for a user-supplied ACP agent binary (`custom_acp`).
 *
 * Probe-first: submit calls `registerCustomAcpConnection`, which runs the
 * registration capability probe (spawn → initialize → session → stop) and
 * persists the connection ONLY on success. A failed probe rejects with the
 * backend error (carrying the agent's stderr tail) and leaves nothing behind —
 * the error renders inline, mirroring the MCP validate-on-add pattern.
 *
 * Secrets: env-var values are passed as `credentials.envVars`; the
 * connections-store writes each value to the OS keychain and strips it from
 * localStorage. This form never touches `store_credential` directly.
 */
export function ConnectCustomAgent({
  onBack,
  onConnected,
}: {
  onBack: () => void;
  onConnected: (connectionId: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('form');
  const [label, setLabel] = useState('');
  const [binaryPath, setBinaryPath] = useState('');
  const [argsText, setArgsText] = useState('');
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [nextRowId, setNextRowId] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    connectionId: string;
    capabilities: AcpDiscoveredCapabilities;
  } | null>(null);

  const probing = phase === 'probing';
  const canSubmit = !probing && label.trim().length > 0 && binaryPath.trim().length > 0;

  const handleBrowse = useCallback(async () => {
    try {
      const path = await tauriApi.openFileDialog();
      if (path) setBinaryPath(path);
    } catch {
      // Dialog unavailable — the path input remains the manual fallback.
    }
  }, []);

  const addEnvRow = useCallback(() => {
    setEnvRows((rows) => [...rows, { id: nextRowId, name: '', value: '', show: false }]);
    setNextRowId((id) => id + 1);
  }, [nextRowId]);

  const updateEnvRow = useCallback((id: number, patch: Partial<Omit<EnvRow, 'id'>>) => {
    setEnvRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const removeEnvRow = useCallback((id: number) => {
    setEnvRows((rows) => rows.filter((r) => r.id !== id));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setPhase('probing');
    setError(null);

    const trimmedArgs = argsText.trim();
    const binaryArgs = trimmedArgs ? trimmedArgs.split(/\s+/) : undefined;
    const envVars: Record<string, string> = {};
    for (const row of envRows) {
      const name = row.name.trim();
      if (name && row.value) envVars[name] = row.value;
    }

    try {
      const res = await registerCustomAcpConnection({
        label: label.trim(),
        binaryPath: binaryPath.trim(),
        binaryArgs,
        envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
      });
      setResult(res);
      setPhase('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('form');
    }
  }, [canSubmit, label, binaryPath, argsText, envRows]);

  // Split the probe error into a headline (first line) and detail tail
  // (stderr lines from the backend) for the collapsible details panel.
  const [errorHeadline, errorDetail] = error
    ? [error.split('\n')[0], error.split('\n').slice(1).join('\n').trim()]
    : [null, ''];

  if (phase === 'success' && result) {
    const caps = result.capabilities;
    const modes = caps.availableModes ?? [];
    const configOptions = caps.configOptions ?? [];
    return (
      <div className="p-4 space-y-3">
        <Header />
        <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            Connected
            {caps.agentVersion && (
              <span className="font-normal text-muted-foreground">v{caps.agentVersion}</span>
            )}
          </div>
          {modes.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Modes</p>
              <div className="flex flex-wrap gap-1">
                {modes.map((m) => (
                  <Badge key={m.id} variant="secondary" className="h-4 px-1.5 text-xs font-normal">
                    {m.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{caps.supportsImages ? 'Images supported' : 'No image input'}</span>
            <span>
              {configOptions.length > 0
                ? `${configOptions.length} config option${configOptions.length !== 1 ? 's' : ''}`
                : 'No config options'}
            </span>
            {caps.supportsLoadSession && <span>Session restore</span>}
          </div>
        </div>
        <Button size="sm" className="w-full" onClick={() => onConnected(result.connectionId)}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <Header />
      <p className="text-xs text-muted-foreground">
        Connect any agent that speaks the Agent Client Protocol over stdio. The binary is
        probed before the connection is saved.
      </p>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 space-y-1.5">
          <div className="flex items-start gap-1.5 text-xs font-medium text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" strokeWidth={1.5} />
            <span className="break-words">{errorHeadline}</span>
          </div>
          {errorDetail && (
            <Collapsible>
              <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                Show details
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                  {errorDetail}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="custom-agent-label" className="text-xs text-muted-foreground">
          Name
        </Label>
        <Input
          id="custom-agent-label"
          type="text"
          placeholder="e.g. My Agent"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={probing}
          className="text-sm h-8"
          autoFocus
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="custom-agent-binary" className="text-xs text-muted-foreground">
          Binary path
        </Label>
        <div className="flex gap-2">
          <Input
            id="custom-agent-binary"
            type="text"
            placeholder="/usr/local/bin/my-acp-agent"
            value={binaryPath}
            onChange={(e) => setBinaryPath(e.target.value)}
            disabled={probing}
            className="font-mono text-sm h-8 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={handleBrowse}
            disabled={probing}
            aria-label="Browse for agent binary"
          >
            <FolderOpen className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
            Browse
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="custom-agent-args" className="text-xs text-muted-foreground">
          Arguments <span className="text-[10px]">(optional, space-separated)</span>
        </Label>
        <Input
          id="custom-agent-args"
          type="text"
          placeholder="e.g. acp"
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          disabled={probing}
          className="font-mono text-sm h-8"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Environment variables</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={addEnvRow}
            disabled={probing}
          >
            <Plus className="h-3 w-3 mr-1" strokeWidth={1.5} />
            Add variable
          </Button>
        </div>
        {envRows.length > 0 && (
          <div className="space-y-1.5">
            {envRows.map((row) => (
              <div key={row.id} className="flex gap-1.5 items-center">
                <Input
                  type="text"
                  placeholder="NAME"
                  aria-label="Variable name"
                  value={row.name}
                  onChange={(e) => updateEnvRow(row.id, { name: e.target.value })}
                  disabled={probing}
                  className="font-mono text-xs h-8 w-[40%]"
                />
                <div className="relative flex-1">
                  <Input
                    type={row.show ? 'text' : 'password'}
                    placeholder="value"
                    aria-label="Variable value"
                    value={row.value}
                    onChange={(e) => updateEnvRow(row.id, { value: e.target.value })}
                    disabled={probing}
                    className="font-mono text-xs h-8 pr-8"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => updateEnvRow(row.id, { show: !row.show })}
                    aria-label={row.show ? 'Hide value' : 'Show value'}
                    tabIndex={-1}
                  >
                    {row.show ? (
                      <EyeOff className="h-3.5 w-3.5" strokeWidth={1.5} />
                    ) : (
                      <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
                    )}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => removeEnvRow(row.id)}
                  disabled={probing}
                  aria-label="Remove variable"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                </Button>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Values are stored in the OS keychain, never on disk.
            </p>
          </div>
        )}
      </div>

      {probing && (
        <div className="flex items-center gap-2.5 py-1">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
          <span className="text-sm text-muted-foreground">Probing agent…</span>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={probing} className="flex-1">
          Back
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit} className="flex-1">
          Connect
        </Button>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <ProviderLogo provider="custom_acp" className="w-5 h-5 shrink-0" />
      <span className="text-sm font-medium">Custom Agent</span>
    </div>
  );
}
