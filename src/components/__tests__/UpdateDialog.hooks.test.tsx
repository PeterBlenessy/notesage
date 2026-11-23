// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, cleanup } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UpdateDialog } from '@/components/UpdateDialog';
import type { UpdateInfo } from '@/hooks/useAutoUpdate';

// A stand-in that, like the real `useChangelog`, HOLDS STATE in a hook and
// does its work on mount. The other UpdateDialog test file mocks it with a
// plain function, which cannot show when the hook runs.
let changelogMounts = 0;
vi.mock('@/hooks/useChangelog', () => ({
  useChangelog: () => {
    const [changelog] = useState(() => {
      changelogMounts += 1;
      return null;
    });
    return { changelog, loading: false, getChangesBetween: () => [] };
  },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

const INFO: UpdateInfo = { version: '1.0.0', currentVersion: '0.9.0', notes: null, date: null };

function dialog(updateInfo: UpdateInfo | null) {
  return (
    <TooltipProvider>
      <UpdateDialog
        open={true}
        onOpenChange={vi.fn()}
        updateInfo={updateInfo}
        status="available"
        progress={null}
        onInstall={vi.fn()}
        onRestartNow={vi.fn()}
        onDismiss={vi.fn()}
      />
    </TooltipProvider>
  );
}

afterEach(() => cleanup());

/**
 * `useChangelog()` used to be called below `if (!updateInfo) return null` in
 * one component (audit 2026-11-22 §7, "Out of category"). It now lives in an
 * inner component that is only mounted while there is an update, so the hook
 * runs on every render of the component that owns it.
 *
 * These pin the two things that fix must keep true. Neither failed before
 * it: React does not throw for a conditional hook when no hook precedes it,
 * so the old shape was a latent violation rather than a live crash.
 */
describe('UpdateDialog — where the changelog hook runs', () => {
  it('survives updateInfo going from set to null and back (a re-check clears it)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(dialog(INFO));
    expect(document.body.textContent).toContain('Update Available');

    expect(() => rerender(dialog(null))).not.toThrow();
    expect(document.body.textContent).not.toContain('Update Available');

    expect(() => rerender(dialog(INFO))).not.toThrow();
    expect(document.body.textContent).toContain('Update Available');
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/order of Hooks|fewer hooks|more hooks/i);
    errors.mockRestore();
  });

  it('does not load the changelog while there is no update to show', () => {
    // Hoisting the hook above the early return would also satisfy the rules
    // of hooks — and fetch the remote changelog on every launch.
    changelogMounts = 0;
    render(dialog(null));
    expect(changelogMounts).toBe(0);
  });
});
