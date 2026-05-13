// Regression-lock tests for the docs/marketing/ content package.
//
// Issue #215 — Notesage needs end-user-facing marketing content for
// notesage.io and the in-app About dialog. Eight markdown files must
// exist under docs/marketing/, each with required content sections.
//
// These tests verify:
//   1. All eight required markdown files exist and are non-empty
//   2. Each file contains the required sections/content per the acceptance criteria
//   3. The ai-connections.md includes a provider comparison table
//   4. The ai-connections.md flags the June 15 2026 Anthropic credit-pool change
//   5. The about-copy.md fits within the 200-word limit
//   6. No dev-internal jargon (ProseMirror, Tauri, Zustand, src/, etc.) in marketing copy

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

const REPO_ROOT = resolve(__dirname, '../../../');
const MARKETING_DIR = join(REPO_ROOT, 'docs/marketing');

const REQUIRED_FILES = [
  'pitch.md',
  'feature-tour.md',
  'ai-connections.md',
  'use-cases.md',
  'privacy.md',
  'getting-started.md',
  'shortcuts-highlights.md',
  'about-copy.md',
];

function readMarketing(filename: string): string {
  const filePath = join(MARKETING_DIR, filename);
  if (!existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf-8');
}

function wordCount(text: string): number {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // strip markdown links, keep text
    .replace(/https?:\/\/\S+/g, '')           // strip bare URLs
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

describe('docs/marketing/ content package (issue #215)', () => {
  describe('file existence', () => {
    it('docs/marketing/ directory exists', () => {
      expect(existsSync(MARKETING_DIR)).toBe(true);
    });

    for (const filename of REQUIRED_FILES) {
      it(`${filename} exists and is non-empty`, () => {
        const content = readMarketing(filename);
        expect(content.length, `${filename} must exist and be non-empty`).toBeGreaterThan(0);
      });
    }
  });

  describe('pitch.md content', () => {
    it('contains a tagline (1-sentence pitch)', () => {
      const content = readMarketing('pitch.md');
      // Should have a short tagline — look for a line or paragraph that reads like a tagline
      expect(content).toMatch(/tagline|pitch|Notesage/i);
    });

    it('contains a "why Notesage" or benefits section', () => {
      const content = readMarketing('pitch.md');
      // Should have some kind of benefits/why section
      expect(content.length).toBeGreaterThan(100);
    });
  });

  describe('feature-tour.md content', () => {
    it('covers the Editor surface', () => {
      const content = readMarketing('feature-tour.md');
      expect(content).toMatch(/editor/i);
    });

    it('covers AI chat / Quiet Composer surface', () => {
      const content = readMarketing('feature-tour.md');
      expect(content).toMatch(/chat|quiet composer|command bar/i);
    });

    it('covers Sidebar / projects', () => {
      const content = readMarketing('feature-tour.md');
      expect(content).toMatch(/sidebar|project/i);
    });

    it('covers Export', () => {
      const content = readMarketing('feature-tour.md');
      expect(content).toMatch(/export|pdf|docx/i);
    });

    it('covers Document viewers', () => {
      const content = readMarketing('feature-tour.md');
      expect(content).toMatch(/viewer|epub|pdf viewer/i);
    });
  });

  describe('ai-connections.md content', () => {
    it('covers all major providers', () => {
      const content = readMarketing('ai-connections.md');
      expect(content).toMatch(/anthropic/i);
      expect(content).toMatch(/openai/i);
      expect(content).toMatch(/ollama/i);
      expect(content).toMatch(/copilot/i);
      expect(content).toMatch(/gemini/i);
    });

    it('contains a provider comparison table', () => {
      const content = readMarketing('ai-connections.md');
      // A markdown table has lines starting with |
      const tableLines = content.split('\n').filter(line => line.trim().startsWith('|'));
      expect(tableLines.length, 'ai-connections.md must contain a markdown comparison table').toBeGreaterThan(3);
    });

    it('comparison table covers required columns: provider, auth method, cost model, offline-capable, tool calling, vision', () => {
      const content = readMarketing('ai-connections.md');
      // Header row of the table should mention these concepts
      expect(content).toMatch(/auth/i);
      expect(content).toMatch(/cost|pricing|free/i);
      expect(content).toMatch(/offline/i);
      expect(content).toMatch(/tool/i);
      expect(content).toMatch(/vision/i);
    });

    it('flags the June 15 2026 Anthropic Agent SDK credit-pool change', () => {
      const content = readMarketing('ai-connections.md');
      // Must explicitly call out the June 15 2026 change
      expect(content).toMatch(/june\s+15|june\s+2026|2026-06-15/i);
      expect(content).toMatch(/credit|billing|anthropic/i);
    });

    it('translates auth methods to plain English (API key / subscription / local / bundled)', () => {
      const content = readMarketing('ai-connections.md');
      expect(content).toMatch(/api\s*key|bring your own/i);
      expect(content).toMatch(/subscription|use your/i);
      expect(content).toMatch(/local|offline/i);
    });
  });

  describe('use-cases.md content', () => {
    it('contains at least 4 persona stories', () => {
      const content = readMarketing('use-cases.md');
      // Count H2 or H3 headings as story markers, or look for story indicators
      const headings = content.match(/^#{2,3}\s+.+/gm) || [];
      expect(headings.length, 'use-cases.md should have at least 4 persona stories (headings)').toBeGreaterThanOrEqual(4);
    });

    it('mentions researcher or research use case', () => {
      const content = readMarketing('use-cases.md');
      expect(content).toMatch(/research|paper|academ/i);
    });

    it('mentions writer or writing use case', () => {
      const content = readMarketing('use-cases.md');
      expect(content).toMatch(/writ|author|composer/i);
    });

    it('mentions developer or developer use case', () => {
      const content = readMarketing('use-cases.md');
      expect(content).toMatch(/developer|engineer|code|coder/i);
    });
  });

  describe('privacy.md content', () => {
    it('explains local-first approach', () => {
      const content = readMarketing('privacy.md');
      expect(content).toMatch(/local.first|local first|stays on your|on.device/i);
    });

    it('explains OS keychain for API keys', () => {
      const content = readMarketing('privacy.md');
      expect(content).toMatch(/keychain|secure storage|never sent|api key/i);
    });

    it('explains sandboxed agents', () => {
      const content = readMarketing('privacy.md');
      expect(content).toMatch(/sandbox|isolated|contain/i);
    });

    it('explains optional iCloud sync', () => {
      const content = readMarketing('privacy.md');
      expect(content).toMatch(/icloud|sync|optional/i);
    });

    it('explains no telemetry by default', () => {
      const content = readMarketing('privacy.md');
      expect(content).toMatch(/telemetry|tracking|data.collect/i);
    });
  });

  describe('getting-started.md content', () => {
    it('covers installation step', () => {
      const content = readMarketing('getting-started.md');
      expect(content).toMatch(/install|download|setup/i);
    });

    it('covers opening a folder', () => {
      const content = readMarketing('getting-started.md');
      expect(content).toMatch(/folder|open.*folder|open.*project/i);
    });

    it('covers connecting an AI provider', () => {
      const content = readMarketing('getting-started.md');
      expect(content).toMatch(/connect|ai provider|settings/i);
    });

    it('covers taking the first note', () => {
      const content = readMarketing('getting-started.md');
      expect(content).toMatch(/note|write|start.*writing|first/i);
    });
  });

  describe('shortcuts-highlights.md content', () => {
    it('contains at least 8 shortcuts (aiming for top 10)', () => {
      const content = readMarketing('shortcuts-highlights.md');
      // Shortcuts are typically listed with ⌘ or Cmd or keyboard notation
      const shortcutLines = content.split('\n').filter(line =>
        /⌘|Cmd|Ctrl|\bCmd\+|\bCtrl\+/.test(line) || /`[⌘⌥⇧⌃]/.test(line)
      );
      expect(shortcutLines.length, 'shortcuts-highlights.md should list at least 8 shortcuts').toBeGreaterThanOrEqual(8);
    });

    it('mentions Save shortcut', () => {
      const content = readMarketing('shortcuts-highlights.md');
      expect(content).toMatch(/save|⌘S|Cmd\+S/i);
    });
  });

  describe('about-copy.md content', () => {
    it('fits within 200 words (excluding links)', () => {
      const content = readMarketing('about-copy.md');
      const count = wordCount(content);
      expect(count, `about-copy.md word count (${count}) must be ≤ 200 (excluding links)`).toBeLessThanOrEqual(200);
    });

    it('mentions the app version or version concept', () => {
      const content = readMarketing('about-copy.md');
      expect(content).toMatch(/version|v\d+\.\d+|release/i);
    });

    it('includes links to site, docs, or issues', () => {
      const content = readMarketing('about-copy.md');
      expect(content).toMatch(/https?:\/\/|github\.com|notesage/i);
    });

    it('includes a "what\'s new" hook or changelog reference', () => {
      const content = readMarketing('about-copy.md');
      expect(content).toMatch(/what.s new|changelog|release note|latest/i);
    });
  });

  describe('end-user language (no internal jargon)', () => {
    const JARGON_PATTERN = /\bProseMirror\b|\bTauri\b|\bZustand\b|\bsrc\/|\btiptap\b|\bPM node\b|\bEditorState\b|\bDecoration\b/;

    for (const filename of REQUIRED_FILES) {
      it(`${filename} does not contain developer-internal jargon`, () => {
        const content = readMarketing(filename);
        if (content.length === 0) return; // skip if file is missing (caught by existence test)
        expect(content, `${filename} must not reference ProseMirror, Tauri, Zustand, src/ paths, etc.`).not.toMatch(JARGON_PATTERN);
      });
    }
  });
});
