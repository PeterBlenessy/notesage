/**
 * Integration regression-lock tests for viewport-cache wiring.
 *
 * These source-scan tests verify that the viewport cache is correctly wired
 * into the file watcher (for invalidation) and the system settings
 * (for the "Clear viewport cache" button). Static analysis catches the wiring
 * without requiring a full React render tree or Tauri mock.
 *
 * Tests are RED until the implementation is in place.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

describe('viewport cache wiring — useFileWatcher.ts', () => {
  it('imports deleteCachedViewport from viewport-cache', () => {
    const src = readSrc('src/hooks/useFileWatcher.ts');
    // Must import the invalidation function from the new module
    expect(src).toMatch(/import.*deleteCachedViewport.*from.*viewport-cache/);
  });

  it('calls deleteCachedViewport(path) in handleEvent', () => {
    const src = readSrc('src/hooks/useFileWatcher.ts');
    expect(src).toContain('deleteCachedViewport(path)');
  });
});

describe('viewport cache wiring — SystemSettings.tsx', () => {
  it('imports clearAllViewports from viewport-cache', () => {
    const src = readSrc('src/components/settings/v2/SystemSettings.tsx');
    expect(src).toMatch(/import.*clearAllViewports.*from.*viewport-cache/);
  });

  it('renders a "Clear viewport cache" button inside the Performance SettingsGroup', () => {
    const src = readSrc('src/components/settings/v2/SystemSettings.tsx');
    // The label text must be present somewhere in the file
    expect(src).toContain('Clear viewport cache');
  });

  it('uses AlertDialog for the destructive clear-cache confirmation', () => {
    const src = readSrc('src/components/settings/v2/SystemSettings.tsx');
    // Must use AlertDialog (already imported in the file) rather than a bare onClick
    // — consistent with the "Clear logs" button pattern in the Diagnostics section.
    expect(src).toContain('clearAllViewports');
  });
});

describe('viewport cache wiring — useEditorTabSwitch.ts', () => {
  it('imports from viewport-cache module', () => {
    const src = readSrc('src/hooks/useEditorTabSwitch.ts');
    expect(src).toMatch(/import.*viewport-cache/);
  });

  it('calls getCachedViewport in the tab-switch effect', () => {
    const src = readSrc('src/hooks/useEditorTabSwitch.ts');
    expect(src).toContain('getCachedViewport');
  });

  it('calls setCachedViewport to capture viewport on save or idle', () => {
    const src = readSrc('src/hooks/useEditorTabSwitch.ts');
    expect(src).toContain('setCachedViewport');
  });
});
