import { useMemo, useState } from 'react';
import { Bot, FileText, Bell, Terminal, ArrowUp, ArrowDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSkillStore } from '@/stores/skill-store';
import type { AutomationStep } from '@/lib/automations/types';
import { TokenInput } from './TokenInput';
import type { TokenOption } from './VariablePicker';

const STEP_META: Record<AutomationStep['type'], { icon: typeof Bot; label: string }> = {
  agent: { icon: Bot, label: 'Agent task' },
  document: { icon: FileText, label: 'Create / append note' },
  notify: { icon: Bell, label: 'Notify' },
  skill: { icon: Terminal, label: 'Run skill' },
};

export function StepEditor({
  step,
  tokens,
  showId = true,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  step: AutomationStep;
  tokens: TokenOption[];
  /** Show the editable step id (only meaningful when another step references it). */
  showId?: boolean;
  onChange: (next: AutomationStep) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  const idField = `step-${step.id}`;
  // The optional `if` condition stays hidden behind a disclosure until used.
  const [showIf, setShowIf] = useState(!!step.if);
  // Reactive: recompute when the skill set or enable overrides change, so a
  // skill discovered AFTER the form opened still appears (discovery resolves
  // async after startupReady). getActiveSkills() returns a fresh array each
  // call, so subscribe to the stable source slices — not the result — to avoid
  // a re-render loop.
  const skillsSlice = useSkillStore((s) => s.skills);
  const enabledOverrides = useSkillStore((s) => s.enabledOverrides);
  const skills = useMemo(
    () => useSkillStore.getState().getActiveSkills(),
    [skillsSlice, enabledOverrides],
  );

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-sm font-medium">{meta.label}</span>
        {showId && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">id</span>
            <Input
              aria-label="Step id"
              value={step.id}
              onChange={(e) => onChange({ ...step, id: e.target.value })}
              className="h-7 w-28 font-mono text-xs"
            />
          </div>
        )}
        <div className="ml-auto flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={!canMoveUp}
            aria-label="Move step up"
            onClick={onMoveUp}
          >
            <ArrowUp className="size-3.5" strokeWidth={1.5} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={!canMoveDown}
            aria-label="Move step down"
            onClick={onMoveDown}
          >
            <ArrowDown className="size-3.5" strokeWidth={1.5} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-[var(--color-destructive)]"
            aria-label="Remove step"
            onClick={onRemove}
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      {step.type === 'agent' && (
        <TokenInput
          id={`${idField}-prompt`}
          label="Prompt"
          value={step.prompt}
          onChange={(v) => onChange({ ...step, prompt: v })}
          tokens={tokens}
          multiline
          placeholder="Summarize my notes edited since yesterday."
        />
      )}

      {step.type === 'document' && (
        <>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Mode</Label>
            <Select
              value={step.op}
              onValueChange={(v) => onChange({ ...step, op: v as 'create' | 'append' })}
            >
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="append">Append</SelectItem>
                <SelectItem value="create">Create / overwrite</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <TokenInput
            id={`${idField}-path`}
            label="Path (relative to the scope)"
            value={step.path}
            onChange={(v) => onChange({ ...step, path: v })}
            tokens={tokens}
            placeholder="Daily/{{today}}.md"
          />
          <TokenInput
            id={`${idField}-content`}
            label="Content"
            value={step.content}
            onChange={(v) => onChange({ ...step, content: v })}
            tokens={tokens}
            multiline
            placeholder="## {{today}}&#10;&#10;{{steps.summary.output}}"
          />
        </>
      )}

      {step.type === 'notify' && (
        <>
          <TokenInput
            id={`${idField}-title`}
            label="Title"
            value={step.title}
            onChange={(v) => onChange({ ...step, title: v })}
            tokens={tokens}
            placeholder="Daily digest ready"
          />
          <TokenInput
            id={`${idField}-body`}
            label="Body"
            value={step.body}
            onChange={(v) => onChange({ ...step, body: v })}
            tokens={tokens}
            placeholder="Written to Daily/{{today}}.md"
          />
        </>
      )}

      {step.type === 'skill' && (
        <>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Skill</Label>
            <Select value={step.skill} onValueChange={(v) => onChange({ ...step, skill: v })}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Pick a skill" />
              </SelectTrigger>
              <SelectContent>
                {skills.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No skills found</div>
                )}
                {skills.map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idField}-script`} className="text-xs text-muted-foreground">
              Script (path within the skill)
            </Label>
            <Input
              id={`${idField}-script`}
              value={step.script}
              onChange={(e) => onChange({ ...step, script: e.target.value })}
              placeholder="scripts/move.sh"
              className="text-sm"
            />
          </div>
          <TokenInput
            id={`${idField}-args`}
            label="Arguments (one per line)"
            value={(step.args ?? []).join('\n')}
            onChange={(v) =>
              onChange({
                ...step,
                args: v.split('\n').map((a) => a.trim()).filter(Boolean),
              })
            }
            tokens={tokens}
            multiline
            placeholder="{{trigger.file}}"
          />
        </>
      )}

      {showIf ? (
        <TokenInput
          id={`${idField}-if`}
          label="Only run this step if…"
          value={step.if ?? ''}
          onChange={(v) => onChange({ ...step, if: v.trim() || undefined })}
          tokens={tokens}
          placeholder={'e.g. steps.classify.output contains "urgent"'}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowIf(true)}
          className="text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          + Add a condition
        </button>
      )}
    </div>
  );
}
