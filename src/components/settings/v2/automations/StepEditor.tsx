import { useState } from 'react';
import { Bot, FileText, Bell, ArrowUp, ArrowDown, X } from 'lucide-react';
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
import type { AutomationStep } from '@/lib/automations/types';
import { TokenInput } from './TokenInput';
import type { TokenOption } from './VariablePicker';

const STEP_META: Record<AutomationStep['type'], { icon: typeof Bot; label: string }> = {
  agent: { icon: Bot, label: 'Agent task' },
  document: { icon: FileText, label: 'Create / append note' },
  notify: { icon: Bell, label: 'Notify' },
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
            placeholder="Daily/notes.md"
          />
          <TokenInput
            id={`${idField}-content`}
            label="Content"
            value={step.content}
            onChange={(v) => onChange({ ...step, content: v })}
            tokens={tokens}
            multiline
            placeholder="Markdown to write…"
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
            placeholder="Notification text"
          />
        </>
      )}

      {showIf ? (
        <div className="space-y-1">
          <TokenInput
            id={`${idField}-if`}
            label="Only run this step if…"
            value={step.if ?? ''}
            onChange={(v) => onChange({ ...step, if: v.trim() || undefined })}
            tokens={tokens}
            placeholder={'e.g. steps.classify.output contains "urgent"'}
          />
          <button
            type="button"
            onClick={() => {
              onChange({ ...step, if: undefined });
              setShowIf(false);
            }}
            className="text-xs text-muted-foreground transition-colors duration-150 hover:text-[var(--color-destructive)]"
          >
            Remove condition
          </button>
        </div>
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
