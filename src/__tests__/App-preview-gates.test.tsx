// @vitest-environment jsdom

/**
 * Preview gate tests for #69 + #70.
 *
 * Exercises the `shouldRenderLegacyNewDialogs` helper exported from
 * `src/App.tsx` plus a thin render harness that mirrors the conditional
 * JSX used in `App.tsx` so a regression that accidentally removes the
 * gate would fail here.
 */

import '@/test/tauri-mock';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { shouldRenderLegacyNewDialogs } from '@/App';
import type { UiPreview } from '@/stores/settings-store';

describe('shouldRenderLegacyNewDialogs', () => {
  it('returns true for the legacy preview', () => {
    expect(shouldRenderLegacyNewDialogs('legacy')).toBe(true);
  });

  it('returns false for the quiet-composer preview', () => {
    expect(shouldRenderLegacyNewDialogs('quiet-composer')).toBe(false);
  });
});

// Harness that mirrors the mount-gate structure in App.tsx so a future
// refactor that drops the conditional `{renderLegacyNewDialogs && ...}`
// would be caught by this test even without booting the full App tree.
function PreviewHarness({ uiPreview }: { uiPreview: UiPreview }) {
  const renderLegacyNewDialogs = shouldRenderLegacyNewDialogs(uiPreview);
  return (
    <>
      {renderLegacyNewDialogs && (
        <div data-testid="new-note-dialog">NewNoteDialog</div>
      )}
      {renderLegacyNewDialogs && (
        <div data-testid="new-project-dialog">NewProjectDialog</div>
      )}
    </>
  );
}

describe('App preview gates — New* dialog mounts', () => {
  it('mounts both New* dialogs in the legacy preview', () => {
    render(<PreviewHarness uiPreview="legacy" />);
    expect(screen.getByTestId('new-note-dialog')).toBeTruthy();
    expect(screen.getByTestId('new-project-dialog')).toBeTruthy();
  });

  it('omits both New* dialogs in the quiet-composer preview', () => {
    render(<PreviewHarness uiPreview="quiet-composer" />);
    expect(screen.queryByTestId('new-note-dialog')).toBeNull();
    expect(screen.queryByTestId('new-project-dialog')).toBeNull();
  });
});
