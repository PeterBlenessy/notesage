import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Clock, FileText, Workflow, Play, Trash2, AlertTriangle, Plus, Pencil } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import { useAutomationStore } from '@/stores/automation-store';
import { usePermissionStore } from '@/stores/permission-store';
import { runAutomationNow } from '@/lib/automations/run-bridge';
import { needsArming, isArmed } from '@/lib/automations/arm';
import type { Automation, RunStatus, TriggerType } from '@/lib/automations/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';
import { AutomationForm } from './automations/AutomationForm';
import { ArmDialog } from './automations/ArmDialog';
import { RunsHistory } from './automations/RunsHistory';

const TRIGGER_ICON: Record<TriggerType, typeof Clock> = {
  schedule: Clock,
  file: FileText,
  workflow: Workflow,
};

const STATUS_DOT: Record<RunStatus, string> = {
  done: 'bg-[var(--color-accent-primary)]',
  error: 'bg-[var(--color-destructive)]',
  running: 'bg-[var(--color-accent-primary)] animate-pulse',
  skipped: 'bg-muted-foreground/40',
};

function scopeLabel(scope: string | undefined): string {
  if (!scope || scope === 'global') return 'Global';
  return scope.split('/').filter(Boolean).pop() ?? scope;
}

function AutomationItem({
  automation,
  onEdit,
  onArm,
  onHistory,
}: {
  automation: Automation;
  onEdit: () => void;
  onArm: () => void;
  onHistory: () => void;
}) {
  const setEnabled = useAutomationStore((s) => s.setEnabled);
  const remove = useAutomationStore((s) => s.remove);
  const lastRun = useAutomationStore((s) => s.runsByAutomation[automation.sourcePath]?.[0]);
  // Subscribe to the arm record so the badge updates the moment it's armed.
  const armRecord = usePermissionStore((s) => s.automationArm[automation.sourcePath]);
  const [armed, setArmed] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!needsArming(automation)) {
      setArmed(true);
      return;
    }
    void isArmed(automation).then((ok) => {
      if (!cancelled) setArmed(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [automation, armRecord]);

  const Icon = TRIGGER_ICON[automation.trigger.type];
  const disarmed = needsArming(automation) && !armed;

  return (
    <li className="flex items-center gap-3 py-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{automation.name}</span>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {scopeLabel(automation.scope)}
          </Badge>
          {disarmed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onArm} className="shrink-0">
                  <Badge
                    variant="outline"
                    className="cursor-pointer gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    <AlertTriangle className="size-3" strokeWidth={1.5} />
                    Needs arming
                  </Badge>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Contains a write step — click to review &amp; arm it.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {lastRun && (
          <button
            type="button"
            onClick={onHistory}
            className="mt-0.5 flex items-center gap-1.5 hover:underline"
          >
            <span className={cn('size-1.5 rounded-full', STATUS_DOT[lastRun.status])} />
            <span className="text-xs text-muted-foreground">
              Last run {lastRun.status} · history
            </span>
          </button>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            disabled={!automation.enabled}
            aria-label={`Run ${automation.name} now`}
            onClick={() => runAutomationNow(automation.sourcePath)}
          >
            <Play className="size-4" strokeWidth={1.5} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Run now</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={`Edit ${automation.name}`}
            onClick={onEdit}
          >
            <Pencil className="size-4" strokeWidth={1.5} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Edit</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-[var(--color-destructive)]"
            aria-label={`Delete ${automation.name}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" strokeWidth={1.5} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Delete</TooltipContent>
      </Tooltip>

      <Switch
        checked={automation.enabled}
        aria-label={`Enable ${automation.name}`}
        onCheckedChange={(checked) => {
          void setEnabled(automation.sourcePath, checked);
        }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{automation.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the automation file. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void remove(automation.sourcePath);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export function AutomationsSettings() {
  const automationsEnabled = useSettingsStore((s) => s.automationsEnabled);
  const setAutomationsEnabled = useSettingsStore((s) => s.setAutomationsEnabled);
  const startAtLogin = useSettingsStore((s) => s.startAtLogin);
  const closeToTray = useSettingsStore((s) => s.closeToTray);
  const setStartAtLogin = useSettingsStore((s) => s.setStartAtLogin);
  const setCloseToTray = useSettingsStore((s) => s.setCloseToTray);

  const automations = useAutomationStore((s) => s.automations);
  const invalid = useAutomationStore((s) => s.invalid);

  const [reliabilityPrompt, setReliabilityPrompt] = useState(false);
  const [formTarget, setFormTarget] = useState<Automation | 'new' | null>(null);
  const [armTarget, setArmTarget] = useState<Automation | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Automation | null>(null);

  const handleMasterToggle = (checked: boolean) => {
    setAutomationsEnabled(checked);
    if (checked && (!startAtLogin || !closeToTray)) setReliabilityPrompt(true);
  };

  const enableReliability = async () => {
    if (!closeToTray) {
      setCloseToTray(true);
      invoke('set_close_to_tray', { enabled: true }).catch(() => {});
    }
    if (!startAtLogin) {
      setStartAtLogin(true);
      await import('@tauri-apps/plugin-autostart')
        .then((m) => m.enable())
        .catch(() => {});
    }
    setReliabilityPrompt(false);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <SettingsGroup
        label="Automations"
        description="Run agents, scripts, and notes on a schedule or in response to events. Automations run while Notesage is open or in the menu bar."
      >
        <SettingsRow
          label="Enable automations"
          description="Master switch — turn this off to pause every automation."
          htmlFor="automations-enabled"
          control={
            <Switch
              id="automations-enabled"
              checked={automationsEnabled}
              onCheckedChange={handleMasterToggle}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup label="Your automations" bare>
        <div className="py-1">
          <div className="mb-1 flex justify-end">
            <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => setFormTarget('new')}>
              <Plus className="size-3.5" strokeWidth={1.5} />
              New automation
            </Button>
          </div>
          {automations.length === 0 ? (
            <p className="px-1 py-6 text-sm text-muted-foreground">
              No automations yet. Click <span className="font-medium">New automation</span> — or add
              a <code className="rounded bg-muted px-1 py-0.5 text-xs">.yaml</code> file under{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">.notesage/automations/</code>.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {automations.map((a) => (
                <AutomationItem
                  key={a.sourcePath}
                  automation={a}
                  onEdit={() => setFormTarget(a)}
                  onArm={() => setArmTarget(a)}
                  onHistory={() => setHistoryTarget(a)}
                />
              ))}
            </ul>
          )}

          {invalid.length > 0 && (
            <div className="mt-3 space-y-1">
              {invalid.map((f) => (
                <div
                  key={f.path}
                  className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground"
                >
                  <AlertTriangle
                    className="mt-0.5 size-3.5 shrink-0 text-[var(--color-destructive)]"
                    strokeWidth={1.5}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{f.path.split('/').pop()}</span> — {f.error}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsGroup>

      <AlertDialog open={reliabilityPrompt} onOpenChange={setReliabilityPrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run automations reliably?</AlertDialogTitle>
            <AlertDialogDescription>
              Automations only fire while Notesage is running. Enabling{' '}
              <strong>Start at login</strong> and <strong>Close window to tray</strong> keeps it
              quietly available so scheduled runs aren’t missed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={() => void enableReliability()}>
              Enable both
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={formTarget !== null} onOpenChange={(open) => !open && setFormTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {formTarget && formTarget !== 'new' ? 'Edit automation' : 'New automation'}
            </DialogTitle>
          </DialogHeader>
          {formTarget !== null && (
            <AutomationForm target={formTarget} onClose={() => setFormTarget(null)} />
          )}
        </DialogContent>
      </Dialog>

      <ArmDialog automation={armTarget} onClose={() => setArmTarget(null)} />

      <Dialog open={historyTarget !== null} onOpenChange={(open) => !open && setHistoryTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{historyTarget?.name} — run history</DialogTitle>
          </DialogHeader>
          {historyTarget && <RunsHistory sourcePath={historyTarget.sourcePath} />}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
