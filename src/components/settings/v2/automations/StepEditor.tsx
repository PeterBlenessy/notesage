import { useMemo } from 'react';
import { Bot, FileText, Bell, Terminal, ArrowUp, ArrowDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { VariablePicker, type TokenOption } from './VariablePicker';

const STEP_META: Record<AutomationStep['type'], { icon: typeof Bot; label: string }> = {
  agent: { icon: Bot, label: 'Agent task' },
  document: { icon: FileText, label: 'Create / append note' },
  notify: { icon: Bell, label: 'Notify' },
  skill: { icon: Terminal, label: 'Run skill' },
};

/** A labelled text field with an attached "Insert variable" picker (appends). */
function TokenField({
  id,
  label,
  value,
  onChange,
  tokens,
  multiline,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  tokens: TokenOption[];
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
        <VariablePicker tokens={tokens} onInsert={(t) => onChange(value + t)} />
      </div>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-18 text-sm"
        />
      ) : (
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="text-sm"
        />
      )}
    </div>
  );
}

export function StepEditor({
  step,
  tokens,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  step: AutomationStep;
  tokens: TokenOption[];
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
        <Input
          aria-label="Step id"
          value={step.id}
          onChange={(e) => onChange({ ...step, id: e.target.value })}
          className="h-7 w-32 text-xs"
        />
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
        <TokenField
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
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Mode</Label>
            <Select
              value={step.op}
              onValueChange={(v) => onChange({ ...step, op: v as 'create' | 'append' })}
            >
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="append">Append</SelectItem>
                <SelectItem value="create">Create / overwrite</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <TokenField
            id={`${idField}-path`}
            label="Path (relative to the scope)"
            value={step.path}
            onChange={(v) => onChange({ ...step, path: v })}
            tokens={tokens}
            placeholder="Daily/{{today}}.md"
          />
          <TokenField
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
          <TokenField
            id={`${idField}-title`}
            label="Title"
            value={step.title}
            onChange={(v) => onChange({ ...step, title: v })}
            tokens={tokens}
            placeholder="Daily digest ready"
          />
          <TokenField
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
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Skill</Label>
            <Select value={step.skill} onValueChange={(v) => onChange({ ...step, skill: v })}>
              <SelectTrigger className="h-7 w-48 text-xs">
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
          <TokenField
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
    </div>
  );
}
