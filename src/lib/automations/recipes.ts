// Starter recipes for the "New automation" gallery — the blank-canvas fix that
// every successful automation builder uses (Zapier templates, Notion, etc.).
// Each recipe pre-fills a complete draft the user can then tweak.
//
// Research: docs/research/automation-builder-ux.md

import { DEFAULT_AUTOMATION_GUARDRAILS, type Automation } from './types';

export interface AutomationRecipe {
  id: string;
  /** Emoji shown on the recipe card. */
  icon: string;
  name: string;
  /** Plain-English "when → do" the card shows so the user knows what it builds. */
  summary: string;
  build: (home: string) => Automation;
}

function base(name: string): Automation {
  return {
    id: '',
    name,
    enabled: true,
    armed: false,
    scope: 'global',
    mode: 'single',
    trigger: { type: 'schedule', cron: '0 8 * * *', catchUp: true },
    guardrails: { ...DEFAULT_AUTOMATION_GUARDRAILS },
    steps: [],
    sourcePath: '',
  };
}

export const RECIPES: AutomationRecipe[] = [
  {
    id: 'daily-digest',
    icon: '🌅',
    name: 'Daily Digest',
    summary: 'Every morning, summarize yesterday’s notes into a daily note.',
    build: () => ({
      ...base('Daily Digest'),
      trigger: { type: 'schedule', cron: '0 8 * * *', catchUp: true },
      steps: [
        {
          id: 'summary',
          type: 'agent',
          prompt: 'Summarize my notes edited since yesterday in 5 concise bullet points.',
        },
        {
          id: 'write',
          type: 'document',
          op: 'append',
          path: 'Daily/{{today}}.md',
          content: '## {{today}}\n\n{{steps.summary.output}}\n',
        },
      ],
    }),
  },
  {
    id: 'inbox-triage',
    icon: '📥',
    name: 'Inbox Triage',
    summary: 'When a note lands in Inbox, suggest a category and tags.',
    build: (home) => ({
      ...base('Inbox Triage'),
      trigger: { type: 'file', event: 'file-created', path: `${home}/Notesage/Inbox` },
      condition: { glob: '*.md' },
      steps: [
        {
          id: 'classify',
          type: 'agent',
          prompt: 'Read {{trigger.file}} and suggest one category and three tags. Be concise.',
        },
        {
          id: 'notify',
          type: 'notify',
          title: 'Inbox item triaged',
          body: '{{steps.classify.output}}',
        },
      ],
    }),
  },
  {
    id: 'on-save-check',
    icon: '✅',
    name: 'On-save Check',
    summary: 'When you save a note, scan it for TODOs and missing tags.',
    build: () => ({
      ...base('On-save Check'),
      trigger: { type: 'workflow', event: 'document-saved' },
      condition: { glob: '**/*.md' },
      steps: [
        {
          id: 'review',
          type: 'agent',
          prompt:
            'Review {{trigger.file}} for unfinished TODOs and missing tags. List anything actionable in a few bullets.',
        },
        { id: 'notify', type: 'notify', title: 'Note reviewed', body: '{{steps.review.output}}' },
      ],
    }),
  },
];
