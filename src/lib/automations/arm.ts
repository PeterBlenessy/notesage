// Approve-to-arm — an automation with a write/script step only runs once the
// user reviews it. Arming content-pins a SHA-256 of the automation's
// security-relevant definition in permission-store; the runner compares the
// stored hash against the current one, so ANY edit auto-disarms (the hashes
// diverge) and re-prompts. Phase 1: `document` (file-write) steps; `skill`
// steps join in Phase 2.
//
// PRD: docs/prds/2026-06-28-automations.md (Task #8)

import { usePermissionStore } from '@/stores/permission-store';
import { useSkillStore } from '@/stores/skill-store';
import { tauriApi } from '@/lib/tauri';
import type { Automation, AutomationStep } from './types';

/** Steps that mutate the filesystem / run code — require arming. */
export function armableSteps(automation: Automation): AutomationStep[] {
  return automation.steps.filter((s) => s.type === 'document' || s.type === 'skill');
}

export function needsArming(automation: Automation): boolean {
  return armableSteps(automation).length > 0;
}

/** Human-readable write/exec scope for the arm dialog. */
export function writeScope(automation: Automation): string[] {
  const base =
    automation.scope && automation.scope !== 'global' ? automation.scope : 'Notesage library';
  const paths = armableSteps(automation)
    .map((s) =>
      s.type === 'document'
        ? s.path
        : s.type === 'skill'
          ? `skill: ${s.skill}/${s.script}`
          : '',
    )
    .filter(Boolean);
  return [base, ...paths];
}

/** Content-pin each skill step's script body, keyed by `skill/script`. */
async function skillScriptHashes(automation: Automation): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const s of automation.steps) {
    if (s.type !== 'skill') continue;
    const entry = useSkillStore.getState().getSkillByName(s.skill);
    if (!entry) continue;
    try {
      out[`${s.skill}/${s.script}`] = await tauriApi.hashSkillScript(entry.path, s.script);
    } catch {
      /* unhashable (missing script) — leave unpinned; the run will error */
    }
  }
  return out;
}

// Recursively sort object keys so the hash is independent of property order.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonical(obj[k]);
        return acc;
      }, {});
  }
  return value;
}

// Behaviour-defining content only — excludes loader-filled (id/scope/sourcePath)
// and non-executing (name/enabled/armed) fields, so a rename or enable-toggle
// does NOT force a re-arm, but any change to what actually runs does.
function securityRelevant(a: Automation) {
  return {
    mode: a.mode,
    trigger: a.trigger,
    condition: a.condition ?? null,
    guardrails: a.guardrails,
    steps: a.steps,
  };
}

/** SHA-256 (hex) of the automation's security-relevant definition. */
export async function computeAutomationHash(automation: Automation): Promise<string> {
  const json = JSON.stringify(canonical(securityRelevant(automation)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * True if the automation needs no arming, or its stored approved hash matches
 * its current definition hash. (Editing the automation changes the hash, so a
 * previously-armed-but-now-edited automation reads as disarmed.)
 */
export async function isArmed(automation: Automation): Promise<boolean> {
  if (!needsArming(automation)) return true;
  const record = usePermissionStore.getState().getAutomationArm(automation.sourcePath);
  if (!record) return false;
  if (record.hash !== (await computeAutomationHash(automation))) return false;
  // A rewritten skill script (unchanged YAML) must also disarm.
  const current = await skillScriptHashes(automation);
  const stored = record.scriptHashes ?? {};
  for (const [key, h] of Object.entries(current)) {
    if (stored[key] !== h) return false;
  }
  return true;
}

/** Arm an automation — pin its definition hash, write scope, and skill-script SHAs. */
export async function armAutomation(automation: Automation): Promise<void> {
  const hash = await computeAutomationHash(automation);
  const scriptHashes = await skillScriptHashes(automation);
  usePermissionStore
    .getState()
    .armAutomation(automation.sourcePath, hash, writeScope(automation), scriptHashes);
}

export function disarmAutomation(sourcePath: string): void {
  usePermissionStore.getState().disarmAutomation(sourcePath);
}
