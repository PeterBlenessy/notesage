/**
 * Tests for editor-styles-store.
 *
 * Covers: fontFamilyCSS resolution (presets, system fonts, fallback),
 * loadSystemFonts, loadSettings, saveSettings, resetToDefaults.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { useEditorStylesStore, fontFamilyCSS, EDITOR_STYLES_DEFAULTS, FONT_PRESETS } from '../editor-styles-store';

beforeEach(() => {
  useEditorStylesStore.setState({
    ...EDITOR_STYLES_DEFAULTS,
    loaded: false,
    systemFonts: [],
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

describe('loadSettings', () => {
  it('loads settings from disk', async () => {
    const stored = JSON.stringify({
      fontFamily: 'georgia',
      fontSize: 18,
      lineHeight: 1.5,
      paragraphSpacing: 1.0,
    });
    setMockInvokeHandler('read_file', () => stored);

    await useEditorStylesStore.getState().loadSettings('/home');

    const state = useEditorStylesStore.getState();
    expect(state.fontFamily).toBe('georgia');
    expect(state.fontSize).toBe(18);
    expect(state.lineHeight).toBe(1.5);
    expect(state.paragraphSpacing).toBe(1.0);
    expect(state.loaded).toBe(true);
  });

  it('loads settings with system font family', async () => {
    const stored = JSON.stringify({ fontFamily: 'Fira Sans', fontSize: 16, lineHeight: 1.7, paragraphSpacing: 0.75 });
    setMockInvokeHandler('read_file', () => stored);

    await useEditorStylesStore.getState().loadSettings('/home');

    expect(useEditorStylesStore.getState().fontFamily).toBe('Fira Sans');
  });

  it('uses defaults when file does not exist', async () => {
    setMockInvokeHandler('read_file', () => { throw new Error('Not found'); });

    await useEditorStylesStore.getState().loadSettings('/home');

    const state = useEditorStylesStore.getState();
    expect(state.fontFamily).toBe(EDITOR_STYLES_DEFAULTS.fontFamily);
    expect(state.loaded).toBe(true);
  });
});

describe('saveSettings', () => {
  it('writes settings to disk', async () => {
    let writtenContent = '';
    setMockInvokeHandler('write_file', (args) => {
      writtenContent = (args as Record<string, string>).content;
    });

    useEditorStylesStore.setState({ fontFamily: 'Fira Sans', fontSize: 20 });
    await useEditorStylesStore.getState().saveSettings('/home');

    const parsed = JSON.parse(writtenContent);
    expect(parsed.fontFamily).toBe('Fira Sans');
    expect(parsed.fontSize).toBe(20);
  });
});

describe('system font persistence', () => {
  it('system font name round-trips through save and load', async () => {
    let writtenContent = '';
    setMockInvokeHandler('write_file', (args) => {
      writtenContent = (args as Record<string, string>).content;
    });
    setMockInvokeHandler('read_file', () => writtenContent);

    // Select a system font and save
    useEditorStylesStore.setState({ fontFamily: 'Fira Sans' });
    await useEditorStylesStore.getState().saveSettings('/home');

    // Reset and reload
    useEditorStylesStore.setState({ fontFamily: 'system', loaded: false });
    await useEditorStylesStore.getState().loadSettings('/home');

    expect(useEditorStylesStore.getState().fontFamily).toBe('Fira Sans');
  });

  it('system font works as CSS value before loadSystemFonts completes', () => {
    // System fonts use their family name directly as CSS value
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
  it('restores all defaults', () => {
    useEditorStylesStore.setState({ fontFamily: 'Fira Sans', fontSize: 22, lineHeight: 2.0, paragraphSpacing: 1.5 });
    useEditorStylesStore.getState().resetToDefaults();

    const state = useEditorStylesStore.getState();
    expect(state.fontFamily).toBe(EDITOR_STYLES_DEFAULTS.fontFamily);
    expect(state.fontSize).toBe(EDITOR_STYLES_DEFAULTS.fontSize);
    expect(state.lineHeight).toBe(EDITOR_STYLES_DEFAULTS.lineHeight);
    expect(state.paragraphSpacing).toBe(EDITOR_STYLES_DEFAULTS.paragraphSpacing);
  });
});
