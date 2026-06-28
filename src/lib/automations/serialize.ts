// Automation → YAML serialization for the form builder. Emits only the AUTHORED
// fields (id/scope/sourcePath are filled by the Rust loader from the file
// location; armed is derived from the content-pin). Round-trips through the
// Rust parser (validated on save).
//
// PRD: docs/prds/2026-06-28-automations.md (Task #10)

import { stringify } from 'yaml';
import type { Automation } from './types';

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'automation'
  );
}

/** Absolute YAML path for a `scope` ('global' | project root) + slug. */
export function buildSourcePath(scope: string, home: string, slug: string): string {
  const base =
    scope === 'global' ? `${home}/.notesage/automations` : `${scope}/.notesage/automations`;
  return `${base}/${slug}.yaml`;
}

/** Serialize the authored fields of an automation to YAML. */
export function serializeAutomation(a: Automation): string {
  const trigger: Record<string, unknown> = { type: a.trigger.type };
  if (a.trigger.type === 'schedule') {
    if (a.trigger.cron) trigger.cron = a.trigger.cron;
    if (a.trigger.catchUp !== undefined) trigger.catchUp = a.trigger.catchUp;
  } else {
    if (a.trigger.event) trigger.event = a.trigger.event;
    if (a.trigger.path) trigger.path = a.trigger.path;
  }

  const doc: Record<string, unknown> = {
    name: a.name,
    enabled: a.enabled,
    mode: a.mode,
    trigger,
  };
  if (a.condition && Object.values(a.condition).some((v) => v !== undefined)) {
    doc.condition = a.condition;
  }
  doc.guardrails = a.guardrails;
  doc.steps = a.steps;

  return stringify(doc, { lineWidth: 0 });
}
