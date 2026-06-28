import { Bot, FileText, Bell, ArrowUp, ArrowDown, X } from 'lucide-react';
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
import type { AutomationStep } from '@/lib/automations/types';
import { VariablePicker, type TokenOption } from './VariablePicker';

const STEP_META: Record<AutomationStep['type'], { icon: typeof Bot; label: string }> = {
  agent: { icon: Bot, label: 'Agent task' },
  document: { icon: FileText, label: 'Create / append note' },
  notify: { icon: Bell, label: 'Notify' },
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
          className="min-h-[72px] text-sm"
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
    </div>
  );
}
