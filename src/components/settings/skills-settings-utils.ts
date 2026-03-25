/** Bundled skill names — always overwritten on startup, not user-manageable. */
export const BUNDLED_SKILL_NAMES = new Set(['create-skill', 'create-agent']);

/** Bundled agent names — always overwritten on startup, not user-manageable. */
export const BUNDLED_AGENT_NAMES = new Set([
  'general-assistant', 'creative-writer', 'technical-editor',
  'fact-checker', 'academic-writer', 'copywriter', 'proofreader',
]);

/** Check if a skill/agent is user-manageable (notesage source, not bundled). */
export function isManageable(source: string, name: string, type: 'skill' | 'agent'): boolean {
  if (source !== 'notesage-global' && source !== 'notesage-project') return false;
  if (type === 'skill') return !BUNDLED_SKILL_NAMES.has(name);
  return !BUNDLED_AGENT_NAMES.has(name);
}

/** Source label and badge styling */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'notesage-project': return 'Project';
    case 'notesage-global': return 'Global';
    case 'claude': return 'Claude Code';
    case 'codex': return 'Codex';
    case 'gemini': return 'Gemini';
    case 'agents': return 'Agents';
    case 'github': return 'GitHub Copilot';
    default: return 'External';
  }
}

export function sourceBadgeClass(source: string): string {
  const base = 'text-xs px-1.5 py-0.5 rounded-md border';
  switch (source) {
    case 'notesage-project':
    case 'notesage-global':
      return `${base} border-border text-foreground`;
    default:
      return `${base} border-border text-muted-foreground`;
  }
}
