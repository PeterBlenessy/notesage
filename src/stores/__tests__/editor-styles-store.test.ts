/**
 * Tests for editor-styles-store.
 *
 * Covers: fontFamilyCSS resolution (presets, system fonts, fallback),
 * loadSystemFonts, loadTypography, saveTypography, per-block-type presets,
 * updatePreset, getEffectiveStyle, legacy API compatibility, resetToDefaults.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { useEditorStylesStore, fontFamilyCSS, EDITOR_STYLES_DEFAULTS, FONT_PRESETS } from '../editor-styles-store';
import { DEFAULT_PRESETS, TYPOGRAPHY_VERSION } from '@/lib/typography-presets';

beforeEach(() => {
  useEditorStylesStore.setState({
    ...EDITOR_STYLES_DEFAULTS,
    loaded: false,
    systemFonts: [],
    presets: { ...DEFAULT_PRESETS },
  });
});

describe('fontFamilyCSS', () => {
  it('resolves preset keys to CSS stacks', () => {
    const css = fontFamilyCSS('system');
    expect(css).toContain('SF Pro');
  });

  it('returns system font family name directly when not a preset', () => {
    const css = fontFamilyCSS('Fira Sans');
    expect(css).toBe('Fira Sans');
  });

  it('falls back to system preset for empty string', () => {
    const css = fontFamilyCSS('');
    expect(css).toContain('SF Pro');
  });

  it('resolves all preset keys without throwing', () => {
    for (const preset of FONT_PRESETS) {
      const css = fontFamilyCSS(preset.value);
      expect(css).toBe(preset.css);
    }
  });
});

describe('loadSystemFonts', () => {
  it('populates systemFonts from Tauri command', async () => {
    const mockFonts = [
      { family: 'Arial', category: 'sans' },
      { family: 'Courier New', category: 'mono' },
      { family: 'Georgia', category: 'serif' },
    ];
    setMockInvokeHandler('list_system_fonts', () => mockFonts);

    await useEditorStylesStore.getState().loadSystemFonts();

    const { systemFonts } = useEditorStylesStore.getState();
    expect(systemFonts).toEqual(mockFonts);
    expect(systemFonts).toHaveLength(3);
  });

  it('handles errors gracefully', async () => {
    setMockInvokeHandler('list_system_fonts', () => {
      throw new Error('Backend unavailable');
    });

    await useEditorStylesStore.getState().loadSystemFonts();

    const { systemFonts } = useEditorStylesStore.getState();
    expect(systemFonts).toEqual([]);
  });
});

describe('loadTypography', () => {
  it('loads typography.json presets', async () => {
    const typographyFile = JSON.stringify({
      version: TYPOGRAPHY_VERSION,
      presets: {
        paragraph: { fontFamily: 'georgia', fontSize: 18, fontWeight: 400, lineHeight: 1.5, spacingBefore: 0, spacingAfter: 1.0 },
      },
    });
    setMockInvokeHandler('read_file', (args) => {
      const path = (args as Record<string, string>).path;
      if (path.endsWith('typography.json')) return typographyFile;
      throw new Error('Not found');
    });

    await useEditorStylesStore.getState().loadTypography('/home');

    const state = useEditorStylesStore.getState();
    expect(state.presets.paragraph.fontFamily).toBe('georgia');
    expect(state.presets.paragraph.fontSize).toBe(18);
    expect(state.presets.paragraph.spacingAfter).toBe(1.0);
    // Heading1 should still have defaults (not in the file)
    expect(state.presets.heading1.fontSize).toBe(DEFAULT_PRESETS.heading1.fontSize);
    expect(state.loaded).toBe(true);
  });

  it('falls back to legacy editor-styles.json migration', async () => {
    const legacyFile = JSON.stringify({
      fontFamily: 'source-serif',
      fontSize: 18,
      lineHeight: 1.8,
      paragraphSpacing: 1.0,
    });
    setMockInvokeHandler('read_file', (args) => {
      const path = (args as Record<string, string>).path;
      if (path.endsWith('editor-styles.json')) return legacyFile;
      throw new Error('Not found');
    });

    await useEditorStylesStore.getState().loadTypography('/home');

    const state = useEditorStylesStore.getState();
    expect(state.presets.paragraph.fontFamily).toBe('source-serif');
    expect(state.presets.paragraph.fontSize).toBe(18);
    expect(state.presets.paragraph.lineHeight).toBe(1.8);
    expect(state.presets.paragraph.spacingAfter).toBe(1.0);
    // Headings should be proportionally scaled
    expect(state.presets.heading1.fontSize).toBe(36); // 18 * 2.0
    expect(state.presets.heading1.fontFamily).toBe('source-serif');
    expect(state.loaded).toBe(true);
  });

  it('writes typography.json after migrating from legacy format', async () => {
    const legacyFile = JSON.stringify({ fontFamily: 'inter', fontSize: 15 });
    let writtenPath = '';
    let writtenContent = '';
    setMockInvokeHandler('read_file', (args) => {
      const path = (args as Record<string, string>).path;
      if (path.endsWith('editor-styles.json')) return legacyFile;
      throw new Error('Not found');
    });
    setMockInvokeHandler('write_file', (args) => {
      const a = args as Record<string, string>;
      writtenPath = a.path;
      writtenContent = a.content;
    });

    await useEditorStylesStore.getState().loadTypography('/home');
    // Allow the fire-and-forget write to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(writtenPath).toBe('/home/.notesage/typography.json');
    const parsed = JSON.parse(writtenContent);
    expect(parsed.version).toBe(TYPOGRAPHY_VERSION);
    expect(parsed.presets.paragraph.fontFamily).toBe('inter');
  });

  it('uses defaults when no files exist', async () => {
    setMockInvokeHandler('read_file', () => { throw new Error('Not found'); });

    await useEditorStylesStore.getState().loadTypography('/home');

    const state = useEditorStylesStore.getState();
    expect(state.presets).toEqual(DEFAULT_PRESETS);
    expect(state.loaded).toBe(true);
  });

  it('syncs legacy flat fields from paragraph preset', async () => {
    const typographyFile = JSON.stringify({
      version: TYPOGRAPHY_VERSION,
      presets: {
        paragraph: { fontFamily: 'inter', fontSize: 15, fontWeight: 400, lineHeight: 1.6, spacingBefore: 0, spacingAfter: 0.5 },
      },
    });
    setMockInvokeHandler('read_file', (args) => {
      const path = (args as Record<string, string>).path;
      if (path.endsWith('typography.json')) return typographyFile;
      throw new Error('Not found');
    });

    await useEditorStylesStore.getState().loadTypography('/home');

    const state = useEditorStylesStore.getState();
    // Legacy flat fields should match paragraph preset
    expect(state.fontFamily).toBe('inter');
    expect(state.fontSize).toBe(15);
    expect(state.lineHeight).toBe(1.6);
    expect(state.paragraphSpacing).toBe(0.5);
  });
});

describe('saveTypography', () => {
  it('writes typography.json with version and presets', async () => {
    let writtenContent = '';
    let writtenPath = '';
    setMockInvokeHandler('write_file', (args) => {
      const a = args as Record<string, string>;
      writtenContent = a.content;
      writtenPath = a.path;
    });

    useEditorStylesStore.getState().updatePreset('heading1', { fontSize: 36 });
    await useEditorStylesStore.getState().saveTypography('/home');

    expect(writtenPath).toBe('/home/.notesage/typography.json');
    const parsed = JSON.parse(writtenContent);
    expect(parsed.version).toBe(TYPOGRAPHY_VERSION);
    expect(parsed.presets.heading1.fontSize).toBe(36);
    expect(parsed.presets.paragraph).toEqual(DEFAULT_PRESETS.paragraph);
  });
});

describe('updatePreset', () => {
  it('updates a single block type field', () => {
    useEditorStylesStore.getState().updatePreset('heading2', { fontSize: 28 });

    const { presets } = useEditorStylesStore.getState();
    expect(presets.heading2.fontSize).toBe(28);
    expect(presets.heading2.fontWeight).toBe(DEFAULT_PRESETS.heading2.fontWeight); // unchanged
  });

  it('updates multiple fields at once', () => {
    useEditorStylesStore.getState().updatePreset('paragraph', { fontFamily: 'inter', fontSize: 15 });

    const { presets } = useEditorStylesStore.getState();
    expect(presets.paragraph.fontFamily).toBe('inter');
    expect(presets.paragraph.fontSize).toBe(15);
  });

  it('syncs legacy flat fields when paragraph is updated', () => {
    useEditorStylesStore.getState().updatePreset('paragraph', { fontFamily: 'georgia', fontSize: 18, spacingAfter: 1.0 });

    const state = useEditorStylesStore.getState();
    expect(state.fontFamily).toBe('georgia');
    expect(state.fontSize).toBe(18);
    expect(state.paragraphSpacing).toBe(1.0);
  });

  it('does not affect legacy flat fields when non-paragraph type is updated', () => {
    useEditorStylesStore.getState().updatePreset('heading1', { fontSize: 40 });

    const state = useEditorStylesStore.getState();
    expect(state.fontSize).toBe(EDITOR_STYLES_DEFAULTS.fontSize); // paragraph unchanged
  });

  it('handles partial types (codeBlock, blockquote)', () => {
    useEditorStylesStore.getState().updatePreset('codeBlock', { fontSize: 16 });

    const { presets } = useEditorStylesStore.getState();
    expect(presets.codeBlock.fontSize).toBe(16);
    expect(presets.codeBlock.fontFamily).toBe('jetbrains-mono');
  });
});

describe('getEffectiveStyle', () => {
  it('returns full BlockTypeStyle for full block types', () => {
    const style = useEditorStylesStore.getState().getEffectiveStyle('paragraph');
    expect(style.fontFamily).toBe('system');
    expect(style.fontSize).toBe(16);
    expect(style.fontWeight).toBe(400);
    expect(style.lineHeight).toBe(1.7);
    expect(style.spacingBefore).toBe(0);
    expect(style.spacingAfter).toBe(0.75);
  });

  it('returns full BlockTypeStyle for partial types with defaults', () => {
    const style = useEditorStylesStore.getState().getEffectiveStyle('codeBlock');
    expect(style.fontFamily).toBe('jetbrains-mono');
    expect(style.fontSize).toBe(14);
    expect(style.fontWeight).toBe(400); // default fill
    expect(style.lineHeight).toBe(DEFAULT_PRESETS.paragraph.lineHeight); // default fill
    expect(style.spacingBefore).toBe(0);
    expect(style.spacingAfter).toBe(0);
  });

  it('reflects preset updates', () => {
    useEditorStylesStore.getState().updatePreset('heading3', { fontSize: 22, fontWeight: 700 });

    const style = useEditorStylesStore.getState().getEffectiveStyle('heading3');
    expect(style.fontSize).toBe(22);
    expect(style.fontWeight).toBe(700);
  });
});

describe('legacy API compatibility', () => {
  it('setFontFamily updates paragraph preset', () => {
    useEditorStylesStore.getState().setFontFamily('georgia');

    const state = useEditorStylesStore.getState();
    expect(state.fontFamily).toBe('georgia');
    expect(state.presets.paragraph.fontFamily).toBe('georgia');
  });

  it('setFontSize updates paragraph preset', () => {
    useEditorStylesStore.getState().setFontSize(20);

    const state = useEditorStylesStore.getState();
    expect(state.fontSize).toBe(20);
    expect(state.presets.paragraph.fontSize).toBe(20);
  });

  it('setLineHeight updates paragraph preset', () => {
    useEditorStylesStore.getState().setLineHeight(2.0);

    const state = useEditorStylesStore.getState();
    expect(state.lineHeight).toBe(2.0);
    expect(state.presets.paragraph.lineHeight).toBe(2.0);
  });

  it('setParagraphSpacing updates paragraph spacingAfter', () => {
    useEditorStylesStore.getState().setParagraphSpacing(1.2);

    const state = useEditorStylesStore.getState();
    expect(state.paragraphSpacing).toBe(1.2);
    expect(state.presets.paragraph.spacingAfter).toBe(1.2);
  });

  it('loadSettings delegates to loadTypography', async () => {
    setMockInvokeHandler('read_file', () => { throw new Error('Not found'); });

    await useEditorStylesStore.getState().loadSettings('/home');

    expect(useEditorStylesStore.getState().loaded).toBe(true);
  });

  it('saveSettings delegates to saveTypography', async () => {
    let writtenPath = '';
    setMockInvokeHandler('write_file', (args) => {
      writtenPath = (args as Record<string, string>).path;
    });

    await useEditorStylesStore.getState().saveSettings('/home');

    expect(writtenPath).toBe('/home/.notesage/typography.json');
  });
});

describe('system font persistence', () => {
  it('system font name round-trips through save and load', async () => {
    let writtenContent = '';
    setMockInvokeHandler('write_file', (args) => {
      writtenContent = (args as Record<string, string>).content;
    });
    setMockInvokeHandler('read_file', (args) => {
      const path = (args as Record<string, string>).path;
      if (path.endsWith('typography.json')) return writtenContent;
      throw new Error('Not found');
    });

    // Select a system font and save
    useEditorStylesStore.getState().setFontFamily('Fira Sans');
    await useEditorStylesStore.getState().saveSettings('/home');

    // Reset and reload
    useEditorStylesStore.setState({ ...EDITOR_STYLES_DEFAULTS, loaded: false, presets: { ...DEFAULT_PRESETS } });
    await useEditorStylesStore.getState().loadSettings('/home');

    expect(useEditorStylesStore.getState().fontFamily).toBe('Fira Sans');
    expect(useEditorStylesStore.getState().presets.paragraph.fontFamily).toBe('Fira Sans');
  });

  it('system font works as CSS value before loadSystemFonts completes', () => {
    const css = fontFamilyCSS('Fira Sans');
    expect(css).toBe('Fira Sans');
  });

  it('preset keys still work unchanged', () => {
    expect(fontFamilyCSS('system')).toContain('SF Pro');
    expect(fontFamilyCSS('georgia')).toContain('Georgia');
    expect(fontFamilyCSS('jetbrains-mono')).toContain('JetBrains Mono');
  });
});

describe('resetToDefaults', () => {
  it('restores all defaults including presets', () => {
    useEditorStylesStore.getState().updatePreset('paragraph', { fontFamily: 'inter', fontSize: 22 });
    useEditorStylesStore.getState().updatePreset('heading1', { fontSize: 44 });

    useEditorStylesStore.getState().resetToDefaults();

    const state = useEditorStylesStore.getState();
    expect(state.fontFamily).toBe(EDITOR_STYLES_DEFAULTS.fontFamily);
    expect(state.fontSize).toBe(EDITOR_STYLES_DEFAULTS.fontSize);
    expect(state.lineHeight).toBe(EDITOR_STYLES_DEFAULTS.lineHeight);
    expect(state.paragraphSpacing).toBe(EDITOR_STYLES_DEFAULTS.paragraphSpacing);
    expect(state.presets.paragraph).toEqual(DEFAULT_PRESETS.paragraph);
    expect(state.presets.heading1).toEqual(DEFAULT_PRESETS.heading1);
  });
});
