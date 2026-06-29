import { useState, type ReactNode } from 'react';
import { Plus, Bot, FileText, Bell, Terminal, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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


/** A labelled form section with an optional description + right-aligned action. */
function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h4 className="text-sm font-medium">{title}</h4>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** "Steps can use … as `{{token}}`" — surfaces the data a trigger exposes. */
function TokenHint({ children, token }: { children: ReactNode; token: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {children} <code className="rounded bg-muted px-1 py-0.5 font-mono">{token}</code>
    </p>
  );
}

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
    steps: [],
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

  const triggerHint =
    draft.trigger.type === 'schedule'
      ? 'Runs automatically on a recurring schedule.'
      : draft.trigger.type === 'file'
        ? 'Runs when a file in the watched folder changes.'
        : 'Runs in response to an in-app event.';

  const scopeLabel =
    draft.scope && draft.scope !== 'global'
      ? (draft.scope.split('/').filter(Boolean).pop() ?? 'project')
      : 'Notesage library';

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
    <div className="space-y-6">
      {/* Identity */}
      <div className="grid gap-4 sm:grid-cols-[1fr_13rem]">
        <div className="space-y-1.5">
          <Label htmlFor="auto-name" className="text-xs font-medium">
            Name
          </Label>
          <Input
            id="auto-name"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Morning Digest"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Scope</Label>
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

      <Separator />

      {/* Trigger */}
      <Section
        title="Trigger"
        description={triggerHint}
        action={
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
            <SelectContent align="end">
              <SelectItem value="schedule">On a schedule</SelectItem>
              <SelectItem value="file">On a file change</SelectItem>
              <SelectItem value="workflow">On an app event</SelectItem>
            </SelectContent>
          </Select>
        }
      >
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
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
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="weekdays-only" className="text-xs text-muted-foreground">
                  Only run on weekdays (Mon–Fri)
                </Label>
                <Switch
                  id="weekdays-only"
                  checked={weekdaysOnly}
                  onCheckedChange={(c) =>
                    update({
                      condition: { ...draft.condition, weekdays: c ? [1, 2, 3, 4, 5] : undefined },
                    })
                  }
                />
              </div>
            </>
          )}

          {draft.trigger.type === 'file' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">When a file is…</Label>
                <Select
                  value={triggerEvent(draft.trigger) ?? 'file-created'}
                  onValueChange={(v) =>
                    update({
                      trigger: {
                        type: 'file',
                        event: v as FileEventName,
                        path: triggerPath(draft.trigger),
                      },
                    })
                  }
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="file-created">Added</SelectItem>
                    <SelectItem value="file-modified">Modified</SelectItem>
                    <SelectItem value="file-deleted">Deleted</SelectItem>
                    <SelectItem value="file-renamed">Renamed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="trigger-path" className="text-xs text-muted-foreground">
                  Watched folder
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
                <p className="text-xs text-muted-foreground">
                  Absolute path. Leave blank to watch the whole {scopeLabel}.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="trigger-glob" className="text-xs text-muted-foreground">
                  Only files matching (optional)
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
                <p className="text-xs text-muted-foreground">
                  Glob relative to the watched folder, e.g.{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono">*.md</code> or{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono">Inbox/*.md</code>.
                </p>
              </div>
              <TokenHint token="{{trigger.file}}">Steps can use the changed file as</TokenHint>
            </>
          )}

          {draft.trigger.type === 'workflow' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Event</Label>
                <Select
                  value={triggerEvent(draft.trigger) ?? 'document-saved'}
                  onValueChange={(v) =>
                    update({ trigger: { type: 'workflow', event: v as WorkflowEventName } })
                  }
                >
                  <SelectTrigger className="text-sm">
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
                <>
                  <div className="space-y-1">
                    <Label htmlFor="wf-glob" className="text-xs text-muted-foreground">
                      Only documents matching (optional)
                    </Label>
                    <Input
                      id="wf-glob"
                      value={draft.condition?.glob ?? ''}
                      onChange={(e) =>
                        update({
                          condition: { ...draft.condition, glob: e.target.value || undefined },
                        })
                      }
                      placeholder="**/*.md"
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">Glob across the {scopeLabel}.</p>
                  </div>
                  <TokenHint token="{{trigger.file}}">Steps can use the saved file as</TokenHint>
                </>
              )}
              {triggerEvent(draft.trigger) === 'agent-task-complete' && (
                <TokenHint token="{{trigger.output}}">
                  Steps can use the finished task’s output as
                </TokenHint>
              )}
              {triggerEvent(draft.trigger) === 'transcription-done' && (
                <TokenHint token="{{trigger.transcriptPath}}">
                  Steps can use the transcript file path as
                </TokenHint>
              )}
            </>
          )}
        </div>
      </Section>

      <Separator />

      {/* Steps */}
      <Section
        title="Steps"
        description="Run top to bottom. Reference an earlier step with its {{tokens}}."
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <Plus className="size-3.5" strokeWidth={1.5} />
                Add step
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onSelect={() => addStep('agent')} className="items-start gap-2">
                <Bot className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                <div className="flex flex-col">
                  <span>Agent task</span>
                  <span className="text-xs text-muted-foreground">Ask an AI agent to do the work</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => addStep('document')} className="items-start gap-2">
                <FileText className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                <div className="flex flex-col">
                  <span>Create / append note</span>
                  <span className="text-xs text-muted-foreground">
                    Write or append to a markdown file
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => addStep('notify')} className="items-start gap-2">
                <Bell className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                <div className="flex flex-col">
                  <span>Notify</span>
                  <span className="text-xs text-muted-foreground">Send a desktop notification</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => addStep('skill')} className="items-start gap-2">
                <Terminal className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                <div className="flex flex-col">
                  <span>Run skill</span>
                  <span className="text-xs text-muted-foreground">
                    Execute a skill script (needs approval)
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {draft.steps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No steps yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add a step to define what this automation does.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {draft.steps.map((s, i) => (
              <div key={i} className="flex gap-2.5">
                <div className="mt-3 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <StepEditor
                    step={s}
                    tokens={tokensFor(i)}
                    showId={draft.steps.length > 1}
                    onChange={(next) => updateStep(i, next)}
                    onRemove={() => removeStep(i)}
                    onMoveUp={() => move(i, -1)}
                    onMoveDown={() => move(i, 1)}
                    canMoveUp={i > 0}
                    canMoveDown={i < draft.steps.length - 1}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Separator />

      {/* Advanced — overlap policy + guardrails (collapsed by default) */}
      <Collapsible>
        <CollapsibleTrigger className="group -mx-2 flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <span>Advanced</span>
          <ChevronDown
            className="size-4 text-muted-foreground group-data-[state=open]:rotate-180 motion-safe:transition-transform motion-safe:duration-150"
            strokeWidth={1.5}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="grid gap-3 sm:grid-cols-3">
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
                    guardrails: {
                      ...draft.guardrails,
                      maxRunsPerDay: Math.max(1, Number(e.target.value) || 1),
                    },
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
          </div>
        </CollapsibleContent>
      </Collapsible>

      {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
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
