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
import { t } from '@/lib/i18n';

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
              aria-label={t("automation.stepId")}
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
            aria-label={t("automation.moveStepUp")}
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
            aria-label={t("automation.moveStepDown")}
            onClick={onMoveDown}
          >
            <ArrowDown className="size-3.5" strokeWidth={1.5} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-[var(--color-destructive)]"
            aria-label={t("automation.removeStep")}
            onClick={onRemove}
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      {step.type === 'agent' && (
        <>
          <TokenInput
            id={`${idField}-prompt`}
            label={t("automation.prompt")}
            value={step.prompt}
            onChange={(v) => onChange({ ...step, prompt: v })}
            tokens={tokens}
            multiline
            placeholder={t("automation.promptPlaceholder")}
          />
          <p className="text-xs text-muted-foreground">
            Runs on your <span className="font-medium">{t("automation.agentTasks")}</span> provider (Settings → AI
            Providers → routing). Tool calls are auto-approved within the automation&apos;s scope, so
            the run never stops to ask — keep file work in-scope and pre-allow any domains the agent
            needs.
          </p>
        </>
      )}

      {step.type === 'document' && (
        <>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("automation.mode")}</Label>
            <Select
              value={step.op}
              onValueChange={(v) => onChange({ ...step, op: v as 'create' | 'append' })}
            >
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="append">{t("automation.modeAppend")}</SelectItem>
                <SelectItem value="create">{t("automation.modeOverwrite")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <TokenInput
            id={`${idField}-path`}
            label={t("automation.pathRelative")}
            value={step.path}
            onChange={(v) => onChange({ ...step, path: v })}
            tokens={tokens}
            placeholder="Daily/notes.md"
          />
          <TokenInput
            id={`${idField}-content`}
            label={t("automation.content")}
            value={step.content}
            onChange={(v) => onChange({ ...step, content: v })}
            tokens={tokens}
            multiline
            placeholder={t("automation.contentPlaceholder")}
          />
        </>
      )}

      {step.type === 'notify' && (
        <>
          <TokenInput
            id={`${idField}-title`}
            label={t("automation.notifyTitle")}
            value={step.title}
            onChange={(v) => onChange({ ...step, title: v })}
            tokens={tokens}
            placeholder={t("automation.notifyTitlePlaceholder")}
          />
          <TokenInput
            id={`${idField}-body`}
            label={t("automation.notifyBody")}
            value={step.body}
            onChange={(v) => onChange({ ...step, body: v })}
            tokens={tokens}
            placeholder={t("automation.notifyBodyPlaceholder")}
          />
        </>
      )}

      {showIf ? (
        <div className="space-y-1">
          <TokenInput
            id={`${idField}-if`}
            label={t("automation.onlyRunIf")}
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
