import { useState } from 'react';
import { Plus, Bot, FileText, Bell, Terminal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAutomationStore } from '@/stores/automation-store';
import { runAutomationNow } from '@/lib/automations/run-bridge';
import { armAutomation, needsArming } from '@/lib/automations/arm';
import { serializeAutomation, slugify, buildSourcePath } from '@/lib/automations/serialize';
import {
  triggerCron,
  triggerCatchUp,
  triggerEvent,
  triggerPath,
  DEFAULT_AUTOMATION_GUARDRAILS as DEFAULT_GUARDRAILS,
} from '@/lib/automations/types';
import type {
  Automation,
  AutomationStep,
  FileEventName,
  RunMode,
  StepType,
  WorkflowEventName,
} from '@/lib/automations/types';
import { TriggerEditor } from './TriggerEditor';
import { StepEditor } from './StepEditor';
import type { TokenOption } from './VariablePicker';


function blankAutomation(): Automation {
  return {
    id: '',
    name: '',
    enabled: true,
    armed: false,
    scope: 'global',
    mode: 'single',
    trigger: { type: 'schedule', cron: '0 8 * * *', catchUp: true },
    guardrails: { ...DEFAULT_GUARDRAILS },
    steps: [{ id: 'notify', type: 'notify', title: '', body: '' }],
    sourcePath: '',
  };
}

function newStep(type: StepType, count: number): AutomationStep {
  const id = `step${count + 1}`;
  if (type === 'agent') return { id, type, prompt: '' };
  if (type === 'document') return { id, type, op: 'append', path: '', content: '' };
  if (type === 'skill') return { id, type, skill: '', script: '', args: [] };
  return { id, type, title: '', body: '' };
}

export function AutomationForm({
  target,
  onClose,
}: {
  target: Automation | 'new';
  onClose: () => void;
}) {
  const projects = useWorkspaceStore((s) => s.projects);
  const home = useSettingsStore((s) => s.homeDir) ?? '';
  const save = useAutomationStore((s) => s.save);

  const isNew = target === 'new';
  const [draft, setDraft] = useState<Automation>(() => (isNew ? blankAutomation() : { ...target }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<Automation>) => setDraft((d) => ({ ...d, ...patch }));

  const tokensFor = (index: number): TokenOption[] => {
    const opts: TokenOption[] = [
      { token: '{{today}}', label: "today's date" },
      { token: '{{now}}', label: 'current date-time' },
    ];
    // Trigger-payload tokens — depend on the trigger kind (the runner populates
    // these on the run context; surface them so they're not undiscoverable).
    const t = draft.trigger;
    if (t.type === 'file' || (t.type === 'workflow' && t.event === 'document-saved')) {
      opts.push({ token: '{{trigger.file}}', label: 'triggering file' });
    }
    if (t.type === 'workflow' && t.event === 'agent-task-complete') {
      opts.push({ token: '{{trigger.output}}', label: 'agent task output' });
    }
    if (t.type === 'workflow' && t.event === 'transcription-done') {
      opts.push({ token: '{{trigger.transcriptPath}}', label: 'transcript path' });
    }
    for (let i = 0; i < index; i++) {
      const s = draft.steps[i];
      if (s?.id) {
        opts.push({ token: `{{steps.${s.id}.output}}`, label: `${s.id} output` });
        opts.push({ token: `{{steps.${s.id}.json}}`, label: `${s.id} json (if structured)` });
      }
    }
    return opts;
  };

  const addStep = (type: StepType) =>
    setDraft((d) => ({ ...d, steps: [...d.steps, newStep(type, d.steps.length)] }));
  const updateStep = (i: number, next: AutomationStep) =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s, idx) => (idx === i ? next : s)) }));
  const removeStep = (i: number) =>
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, idx) => idx !== i) }));
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...d, steps };
    });

  const weekdaysOnly = draft.condition?.weekdays?.length === 5;

  const handleSave = async (run: boolean) => {
    setError(null);
    if (!draft.name.trim()) {
      setError('Give the automation a name.');
      return;
    }
    if (draft.steps.length === 0) {
      setError('Add at least one step.');
      return;
    }
    const slug = slugify(draft.name);
    const sourcePath = isNew ? buildSourcePath(draft.scope ?? 'global', home, slug) : draft.sourcePath;
    const finalDraft: Automation = { ...draft, sourcePath, id: slug };

    setSaving(true);
    try {
      await save(sourcePath, serializeAutomation(finalDraft));
      if (run) {
        if (needsArming(finalDraft)) await armAutomation(finalDraft);
        runAutomationNow(sourcePath);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="auto-name" className="text-xs text-muted-foreground">
            Name
          </Label>
          <Input
            id="auto-name"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Morning Digest"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Scope</Label>
          <Select
            value={draft.scope ?? 'global'}
            disabled={!isNew}
            onValueChange={(v) => update({ scope: v })}
          >
            <SelectTrigger className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">Global (Notesage library)</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.path} value={p.path}>
                  {p.path.split('/').filter(Boolean).pop()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <section className="space-y-2">
        <h4 className="text-sm font-medium">Trigger</h4>

        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">When</Label>
          <Select
            value={draft.trigger.type}
            onValueChange={(v) =>
              update({
                trigger:
                  v === 'file'
                    ? { type: 'file', event: 'file-created', path: '' }
                    : v === 'workflow'
                      ? { type: 'workflow', event: 'document-saved' }
                      : { type: 'schedule', cron: triggerCron(draft.trigger) ?? '0 8 * * *', catchUp: true },
              })
            }
          >
            <SelectTrigger className="h-8 w-44 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="schedule">On a schedule</SelectItem>
              <SelectItem value="file">On a file change</SelectItem>
              <SelectItem value="workflow">On an app event</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {draft.trigger.type === 'schedule' && (
          <>
            <TriggerEditor
              cron={triggerCron(draft.trigger) ?? '0 8 * * *'}
              catchUp={triggerCatchUp(draft.trigger) ?? true}
              onCronChange={(cron) =>
                update({
                  trigger: { type: 'schedule', cron, catchUp: triggerCatchUp(draft.trigger) ?? true },
                })
              }
              onCatchUpChange={(catchUp) =>
                update({
                  trigger: {
                    type: 'schedule',
                    cron: triggerCron(draft.trigger) ?? '0 8 * * *',
                    catchUp,
                  },
                })
              }
            />
            <div className="flex items-center gap-2">
              <Switch
                id="weekdays-only"
                checked={weekdaysOnly}
                onCheckedChange={(c) =>
                  update({
                    condition: { ...draft.condition, weekdays: c ? [1, 2, 3, 4, 5] : undefined },
                  })
                }
              />
              <Label htmlFor="weekdays-only" className="text-xs text-muted-foreground">
                Only run on weekdays (Mon–Fri)
              </Label>
            </div>
          </>
        )}

        {draft.trigger.type === 'file' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs text-muted-foreground">Event</Label>
              <Select
                value={triggerEvent(draft.trigger) ?? 'file-created'}
                onValueChange={(v) =>
                  update({
                    trigger: { type: 'file', event: v as FileEventName, path: triggerPath(draft.trigger) },
                  })
                }
              >
                <SelectTrigger className="h-8 w-44 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="file-created">File added</SelectItem>
                  <SelectItem value="file-modified">File modified</SelectItem>
                  <SelectItem value="file-deleted">File deleted</SelectItem>
                  <SelectItem value="file-renamed">File renamed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="trigger-path" className="text-xs text-muted-foreground">
                Watched folder (absolute; defaults to the scope)
              </Label>
              <Input
                id="trigger-path"
                value={triggerPath(draft.trigger) ?? ''}
                onChange={(e) =>
                  update({
                    trigger: {
                      type: 'file',
                      event: (triggerEvent(draft.trigger) as FileEventName) ?? 'file-created',
                      path: e.target.value,
                    },
                  })
                }
                placeholder={`${home}/Notesage/Inbox`}
                className="text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="trigger-glob" className="text-xs text-muted-foreground">
                Only files matching (glob, relative to the watched folder)
              </Label>
              <Input
                id="trigger-glob"
                value={draft.condition?.glob ?? ''}
                onChange={(e) =>
                  update({ condition: { ...draft.condition, glob: e.target.value || undefined } })
                }
                placeholder="*.md"
                className="font-mono text-sm"
              />
            </div>
          </div>
        )}

        {draft.trigger.type === 'workflow' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs text-muted-foreground">Event</Label>
              <Select
                value={triggerEvent(draft.trigger) ?? 'document-saved'}
                onValueChange={(v) =>
                  update({ trigger: { type: 'workflow', event: v as WorkflowEventName } })
                }
              >
                <SelectTrigger className="h-8 w-52 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="document-saved">A document is saved</SelectItem>
                  <SelectItem value="agent-task-complete">An agent task finishes</SelectItem>
                  <SelectItem value="transcription-done">A transcription finishes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {triggerEvent(draft.trigger) === 'document-saved' && (
              <div className="space-y-1">
                <Label htmlFor="wf-glob" className="text-xs text-muted-foreground">
                  Only documents matching (glob)
                </Label>
                <Input
                  id="wf-glob"
                  value={draft.condition?.glob ?? ''}
                  onChange={(e) =>
                    update({ condition: { ...draft.condition, glob: e.target.value || undefined } })
                  }
                  placeholder="**/*.md"
                  className="font-mono text-sm"
                />
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Steps</h4>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <Plus className="size-3.5" strokeWidth={1.5} />
                Add step
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => addStep('agent')}>
                <Bot className="mr-2 size-4" strokeWidth={1.5} />
                Agent task
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => addStep('document')}>
                <FileText className="mr-2 size-4" strokeWidth={1.5} />
                Create / append note
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => addStep('notify')}>
                <Bell className="mr-2 size-4" strokeWidth={1.5} />
                Notify
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => addStep('skill')}>
                <Terminal className="mr-2 size-4" strokeWidth={1.5} />
                Run skill
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="space-y-2">
          {draft.steps.map((s, i) => (
            <StepEditor
              key={i}
              step={s}
              tokens={tokensFor(i)}
              onChange={(next) => updateStep(i, next)}
              onRemove={() => removeStep(i)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              canMoveUp={i > 0}
              canMoveDown={i < draft.steps.length - 1}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">If already running</Label>
          <Select value={draft.mode} onValueChange={(v) => update({ mode: v as RunMode })}>
            <SelectTrigger className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single">Skip the new run</SelectItem>
              <SelectItem value="queued">Queue it</SelectItem>
              <SelectItem value="restart">Restart</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="max-runs" className="text-xs text-muted-foreground">
            Max runs / day
          </Label>
          <Input
            id="max-runs"
            type="number"
            min={1}
            value={draft.guardrails.maxRunsPerDay}
            onChange={(e) =>
              update({
                guardrails: { ...draft.guardrails, maxRunsPerDay: Math.max(1, Number(e.target.value) || 1) },
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="max-steps" className="text-xs text-muted-foreground">
            Max steps / run
          </Label>
          <Input
            id="max-steps"
            type="number"
            min={1}
            value={draft.guardrails.maxStepsPerRun}
            onChange={(e) =>
              update({
                guardrails: {
                  ...draft.guardrails,
                  maxStepsPerRun: Math.max(1, Number(e.target.value) || 1),
                },
              })
            }
          />
        </div>
      </section>

      {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={() => void handleSave(false)}>
          Save
        </Button>
        <Button type="button" disabled={saving} onClick={() => void handleSave(true)}>
          {needsArming(draft) ? 'Save, arm & run' : 'Save & run'}
        </Button>
      </div>
    </div>
  );
}
