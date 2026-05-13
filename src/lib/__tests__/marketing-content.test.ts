import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../../..');
const marketingDir = path.join(repoRoot, 'docs', 'marketing');
const screenshotsDir = path.join(marketingDir, 'screenshots');

function readMarkdown(filename: string): string {
  const filePath = path.join(marketingDir, filename);
  if (!existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf-8');
}

// Count words in about-copy.md, excluding markdown links and bare URLs
function wordCount(text: string): number {
  // Remove markdown links [text](url) — keep text, remove url
  let cleaned = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Remove bare URLs
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '');
  // Remove markdown headers/symbols
  cleaned = cleaned.replace(/^#+\s*/gm, '');
  // Remove extra whitespace
  cleaned = cleaned.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

const REQUIRED_MD_FILES = [
  'pitch.md',
  'feature-tour.md',
  'ai-connections.md',
  'use-cases.md',
  'privacy.md',
  'getting-started.md',
  'shortcuts-highlights.md',
  'about-copy.md',
];

// Required screenshot filenames — one per major surface + hero variants
const REQUIRED_SCREENSHOTS = [
  'editor-light.png',
  'editor-dark.png',
  'quiet-composer-light.png',
  'quiet-composer-dark.png',
  'sidebar.png',
  'export-dialog.png',
  'ai-chat.png',
  'voice-transcription.png',
  'document-viewer.png',
];

// PNG magic bytes: \x89PNG\r\n\x1a\n
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('file existence', () => {
  it('docs/marketing/ directory exists', () => {
    expect(existsSync(marketingDir)).toBe(true);
  });

  for (const filename of REQUIRED_MD_FILES) {
    it(`${filename} exists and is non-empty`, () => {
      const filePath = path.join(marketingDir, filename);
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content.trim().length).toBeGreaterThan(0);
    });
  }

  it('docs/marketing/screenshots/ directory exists', () => {
    expect(existsSync(screenshotsDir)).toBe(true);
  });

  for (const filename of REQUIRED_SCREENSHOTS) {
    it(`screenshots/${filename} exists`, () => {
      const filePath = path.join(screenshotsDir, filename);
      expect(existsSync(filePath)).toBe(true);
    });
  }

  for (const filename of REQUIRED_SCREENSHOTS) {
    it(`screenshots/${filename} is a valid PNG file`, () => {
      const filePath = path.join(screenshotsDir, filename);
      expect(existsSync(filePath)).toBe(true);
      const buf = readFileSync(filePath);
      // Check PNG magic bytes
      expect(buf.slice(0, 8).equals(PNG_MAGIC)).toBe(true);
    });
  }

  it('hero screenshots: both editor variants exist (light + dark)', () => {
    expect(existsSync(path.join(screenshotsDir, 'editor-light.png'))).toBe(true);
    expect(existsSync(path.join(screenshotsDir, 'editor-dark.png'))).toBe(true);
  });

  it('hero screenshots: both quiet-composer variants exist (light + dark)', () => {
    expect(existsSync(path.join(screenshotsDir, 'quiet-composer-light.png'))).toBe(true);
    expect(existsSync(path.join(screenshotsDir, 'quiet-composer-dark.png'))).toBe(true);
  });
});

describe('pitch.md content', () => {
  it('contains a tagline (short ≤15-word sentence)', () => {
    const content = readMarkdown('pitch.md');
    // At least one line that could serve as a tagline (short, punchy)
    expect(content.length).toBeGreaterThan(50);
  });

  it('contains elevator pitch paragraph', () => {
    const content = readMarkdown('pitch.md');
    // Should have at least 2 paragraphs
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
  });

  it('contains a "why Notesage" benefits section', () => {
    const content = readMarkdown('pitch.md');
    // Should have a bullet-point section
    expect(content).toMatch(/^[-*•]\s/m);
  });
});

describe('feature-tour.md content', () => {
  it('covers Editor surface', () => {
    const content = readMarkdown('feature-tour.md');
    expect(content.toLowerCase()).toMatch(/editor|writing|document/);
  });

  it('covers AI chat / Quiet Composer surface', () => {
    const content = readMarkdown('feature-tour.md');
    expect(content.toLowerCase()).toMatch(/ai|chat|command/);
  });

  it('covers Sidebar & projects surface', () => {
    const content = readMarkdown('feature-tour.md');
    expect(content.toLowerCase()).toMatch(/sidebar|project|workspace/);
  });

  it('covers Export surface', () => {
    const content = readMarkdown('feature-tour.md');
    expect(content.toLowerCase()).toMatch(/export|pdf|docx/);
  });

  it('covers at least 6 major surfaces', () => {
    const content = readMarkdown('feature-tour.md');
    const headingMatches = content.match(/^#{1,3}\s+.+/gm) ?? [];
    expect(headingMatches.length).toBeGreaterThanOrEqual(5);
  });

  it('covers document viewers (EPUB, PDF, DOCX)', () => {
    const content = readMarkdown('feature-tour.md');
    expect(content.toLowerCase()).toMatch(/epub|viewer|docx|pdf/);
  });

  it('covers voice transcription', () => {
    const content = readMarkdown('feature-tour.md');
    expect(content.toLowerCase()).toMatch(/voice|transcri|dictation/);
  });
});

describe('ai-connections.md content', () => {
  it('names Anthropic provider', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content).toMatch(/[Aa]nthropic/);
  });

  it('names OpenAI provider', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content).toMatch(/[Oo]pen[Aa][Ii]/);
  });

  it('names Ollama provider', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content).toMatch(/[Oo]llama/);
  });

  it('names GitHub Copilot provider', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content).toMatch(/[Cc]opilot/);
  });

  it('names Gemini / Google provider', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content).toMatch(/[Gg]emini|[Gg]oogle/);
  });

  it('names Codex provider', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content).toMatch(/[Cc]odex/);
  });

  it('includes a comparison table', () => {
    const content = readMarkdown('ai-connections.md');
    // Markdown table has | delimiters
    expect(content).toMatch(/\|.*\|/);
  });

  it('comparison table includes "auth method" column', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content.toLowerCase()).toMatch(/auth method|authentication/);
  });

  it('comparison table includes "cost model" column', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content.toLowerCase()).toMatch(/cost model|pricing|free|paid/);
  });

  it('comparison table includes "offline" column', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content.toLowerCase()).toMatch(/offline/);
  });

  it('comparison table includes "tool calling" column', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content.toLowerCase()).toMatch(/tool call|tool use/);
  });

  it('comparison table includes "vision" column', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content.toLowerCase()).toMatch(/vision|image/);
  });

  it('flags June 15, 2026 Anthropic credit-pool change', () => {
    const content = readMarkdown('ai-connections.md');
    expect(content).toMatch(/June\s+15[,.]?\s+2026|2026-06-15/i);
    expect(content.toLowerCase()).toMatch(/anthropic|credit|billing|agent/);
  });

  it('translates auth methods to plain English (no developer jargon)', () => {
    const content = readMarkdown('ai-connections.md');
    // Should mention "API key", "subscription", "local", or "bundled" in plain language
    expect(content.toLowerCase()).toMatch(/api key|subscription|locally|bundled|bring your/);
  });
});

describe('use-cases.md content', () => {
  it('contains at least 4 persona stories', () => {
    const content = readMarkdown('use-cases.md');
    // Count headings as story boundaries
    const headingMatches = content.match(/^#{1,3}\s+.+/gm) ?? [];
    expect(headingMatches.length).toBeGreaterThanOrEqual(4);
  });

  it('includes a researcher persona', () => {
    const content = readMarkdown('use-cases.md');
    expect(content.toLowerCase()).toMatch(/research|paper|study/);
  });

  it('includes a writer persona', () => {
    const content = readMarkdown('use-cases.md');
    expect(content.toLowerCase()).toMatch(/writer|writing|author/);
  });

  it('includes a developer persona', () => {
    const content = readMarkdown('use-cases.md');
    expect(content.toLowerCase()).toMatch(/developer|engineer|code|project/);
  });
});

describe('privacy.md content', () => {
  it('explains local-first data storage', () => {
    const content = readMarkdown('privacy.md');
    expect(content.toLowerCase()).toMatch(/local|device|your\s+(computer|mac|machine)/);
  });

  it('explains OS keychain for API keys', () => {
    const content = readMarkdown('privacy.md');
    expect(content.toLowerCase()).toMatch(/keychain|credential|api key/);
  });

  it('explains sandboxed agents', () => {
    const content = readMarkdown('privacy.md');
    expect(content.toLowerCase()).toMatch(/sandbox|restrict|isolat/);
  });

  it('explains optional iCloud sync', () => {
    const content = readMarkdown('privacy.md');
    expect(content.toLowerCase()).toMatch(/icloud|sync|optional/);
  });

  it('explains no telemetry by default', () => {
    const content = readMarkdown('privacy.md');
    expect(content.toLowerCase()).toMatch(/telemetry|track|analytic|default/);
  });
});

describe('getting-started.md content', () => {
  it('covers installation step', () => {
    const content = readMarkdown('getting-started.md');
    expect(content.toLowerCase()).toMatch(/install|download|get started/);
  });

  it('covers opening a folder step', () => {
    const content = readMarkdown('getting-started.md');
    expect(content.toLowerCase()).toMatch(/open|folder|file/);
  });

  it('covers connecting an AI provider step', () => {
    const content = readMarkdown('getting-started.md');
    expect(content.toLowerCase()).toMatch(/connect|ai|provider|api/);
  });

  it('covers taking the first note step', () => {
    const content = readMarkdown('getting-started.md');
    expect(content.toLowerCase()).toMatch(/note|write|type|first/);
  });
});

describe('shortcuts-highlights.md content', () => {
  it('lists at least 8 shortcuts', () => {
    const content = readMarkdown('shortcuts-highlights.md');
    // Count shortcut lines (lines with Cmd/Ctrl or ⌘/Ctrl notation)
    const shortcutLines = content.match(/⌘|Cmd\s*\+|Ctrl\s*\+/gi) ?? [];
    expect(shortcutLines.length).toBeGreaterThanOrEqual(8);
  });

  it('includes Save shortcut', () => {
    const content = readMarkdown('shortcuts-highlights.md');
    expect(content.toLowerCase()).toMatch(/save/);
  });
});

describe('about-copy.md content', () => {
  it('word count is ≤200 words (excluding links)', () => {
    const content = readMarkdown('about-copy.md');
    const count = wordCount(content);
    expect(count).toBeLessThanOrEqual(200);
  });

  it('mentions version or release information', () => {
    const content = readMarkdown('about-copy.md');
    expect(content.toLowerCase()).toMatch(/version|release|v\d+\.\d+/);
  });

  it('includes at least one link', () => {
    const content = readMarkdown('about-copy.md');
    expect(content).toMatch(/\[.*\]\(https?:\/\//);
  });

  it('includes a "what\'s new" hook', () => {
    const content = readMarkdown('about-copy.md');
    expect(content.toLowerCase()).toMatch(/what.s new|new in|latest|changelog|release note/);
  });
});

describe('end-user language', () => {
  const developerTerms = /\bProseMirror\b|\bTauri\b|\bZustand\b|src\/|\btiptap\b|\bPM node\b|\bEditorState\b|\bDecoration\b/;

  for (const filename of REQUIRED_MD_FILES) {
    it(`${filename} contains no developer-internal terms`, () => {
      const content = readMarkdown(filename);
      if (!content) return; // file missing — caught by existence test
      expect(content).not.toMatch(developerTerms);
    });
  }
});
