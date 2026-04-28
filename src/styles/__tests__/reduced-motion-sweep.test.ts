// @vitest-environment node

/**
 * Reduced-motion sweep regression-lock — UI Refresh task #86
 * ============================================================================
 *
 * Audits every Phase 1 surface that introduced motion and asserts that each
 * has SOME mechanism for honoring `prefers-reduced-motion: reduce`. Per the
 * 2026-04-21 UI-refresh PRD task #86, the rule is DISABLED, not shortened —
 * vestibular-sensitive users get instant transitions.
 *
 * The audit is split into three buckets:
 *
 * 1. Component-level JS gating (`useReducedMotion()` hook) — assertions verify
 *    the hook is imported / consulted in the source file. Component-level
 *    behavior tests (in each component's own `__tests__` directory) verify
 *    the rendered className strips entrance animations under reduce.
 *
 * 2. Tailwind `motion-reduce:` variants — assertions verify the variant is
 *    present in the JSX className strings. The variant maps to
 *    `@media (prefers-reduced-motion: reduce)` automatically.
 *
 * 3. Global CSS `@media (prefers-reduced-motion: reduce)` blocks — the catch-
 *    all for Radix portal-mounted surfaces (Dialog, Popover, Tooltip,
 *    DropdownMenu, etc.) where the entrance animation is set by the shadcn
 *    primitive deep in `data-[state=open]:animate-in` and can't be easily
 *    overridden per-call-site. The single block in `globals.css` covers them
 *    all by targeting `[data-slot$="-content"][data-state]` etc.
 *
 * If a surface lands here without a guard, this test should fail and tell the
 * dev where to add one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

const globals = read('src/styles/globals.css');

describe('Reduced-motion sweep (#86) — global CSS guards', () => {
  it('globals.css disables the orb pulse keyframe under reduce', () => {
    // The component also omits the class via `useReducedMotion()`, but the
    // CSS guard is defence-in-depth.
    const block = globals.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.orb-pulsing[^}]*animation:\s*none/,
    );
    expect(block).toBeTruthy();
  });

  it('globals.css zeros typing-fade chrome transitions under reduce', () => {
    // The fade-on-type pulse fades multiple chrome surfaces. Under reduce
    // every one must have transition-duration: 0ms. The `data-doc-head`
    // target was dropped in #131 (DocHead removed); the `docHead` preset
    // key is still persisted for settings-migration safety but no element
    // carries the attribute any more.
    const block = globals.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.app \[data-quiet-toolbar\][\s\S]*?\.app \[data-quiet-status\][\s\S]*?\.app nav\[aria-label="Workspace sidebar"\][\s\S]*?\.app \[data-testid="agent-orb"\][\s\S]*?transition-duration:\s*0ms/,
    );
    expect(block).toBeTruthy();
  });

  it('globals.css zeros focus-mode chrome transitions under reduce', () => {
    // The focus-mode shift on the document area was removed when the
    // `padding-top: 80px` shift came out (live-test 2026-04-25). The
    // remaining focus-mode chrome that animates is the sidebar /
    // toolbar / status / orb fade — those are the rules a reduced-motion
    // user must see zeroed.
    const block = globals.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.app\.focus-mode nav\[aria-label="Workspace sidebar"\][\s\S]*?\.app\.focus-mode \[data-quiet-toolbar\][\s\S]*?\.app\.focus-mode \[data-quiet-status\][\s\S]*?\.app\.focus-mode \[data-testid="agent-orb"\][\s\S]*?transition:\s*none/,
    );
    expect(block).toBeTruthy();
  });

  it('globals.css disables Radix-shadcn entrance/exit animations under reduce', () => {
    // The catch-all that protects Dialog, AlertDialog, Popover, Tooltip,
    // DropdownMenu, ContextMenu, Select, etc. — every shadcn primitive
    // exposes `data-slot="*-content"` on the portal-mounted surface.
    const block = globals.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\[data-slot\$="-content"\]\[data-state\][\s\S]*?animation:\s*none\s*!important[\s\S]*?transition:\s*none\s*!important/,
    );
    expect(block).toBeTruthy();
  });

  it('globals.css Radix block also covers overlays (Dialog/AlertDialog overlays)', () => {
    const block = globals.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\[data-slot\$="-overlay"\]\[data-state\]/,
    );
    expect(block).toBeTruthy();
  });

  it('globals.css Radix block covers the SettingsShell custom Dialog', () => {
    // SettingsShell uses `data-slot="settings-shell-content"` (not the
    // canonical `*-content` ending), so it gets its own selector.
    const block = globals.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\[data-slot="settings-shell-content"\]\[data-state\]/,
    );
    expect(block).toBeTruthy();
  });

  it('reducemotion-skip class still works as the universal opt-in escape hatch', () => {
    // Pre-existing class — tests that we did not regress the original guard.
    const block = globals.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.reducemotion-skip[\s\S]*?transition:\s*none\s*!important[\s\S]*?animation:\s*none\s*!important/,
    );
    expect(block).toBeTruthy();
  });
});

describe('Reduced-motion sweep (#86) — component-level guards', () => {
  // For each surface, we assert that EITHER:
  //   (a) the source imports `useReducedMotion` (JS-driven gate), OR
  //   (b) the source contains a `motion-reduce:` Tailwind variant on the
  //       relevant animation/transition class (CSS-driven gate).

  const surfaces: Array<{
    name: string;
    file: string;
    requireUseReducedMotion?: boolean;
    requireMotionReduce?: boolean | RegExp;
  }> = [
    {
      name: 'FloatingCommandBar lift + transition (cmdbar)',
      file: 'src/components/cmd/FloatingCommandBar.tsx',
      requireUseReducedMotion: true,
    },
    {
      name: 'AgentOrb pulse',
      file: 'src/components/activity/AgentOrb.tsx',
      requireUseReducedMotion: true,
    },
    {
      name: 'FocusPill entrance',
      file: 'src/components/editor/FocusPill.tsx',
      requireUseReducedMotion: true,
    },
    // 'TreeOverlay slide' was removed by sidebar-simplification task
    // #20 — TreeOverlay component deleted; nothing to sweep here.
    {
      name: 'FolderPeek unfurl',
      file: 'src/components/sidebar/quiet/FolderPeek.tsx',
      requireUseReducedMotion: true,
    },
    {
      name: 'FilePreview fade (Radix popover)',
      file: 'src/components/sidebar/quiet/FilePreview.tsx',
      requireUseReducedMotion: true,
      requireMotionReduce: /motion-reduce:/,
    },
    {
      name: 'StatusBar dirty-dot pulse',
      file: 'src/components/editor/StatusBar.tsx',
      requireMotionReduce: /motion-reduce:transition-none/,
    },
    {
      name: 'Toolbar pill fade + table tools entrance (#86 gaps)',
      file: 'src/components/editor/Toolbar.tsx',
      requireMotionReduce: /motion-reduce:/,
    },
    {
      name: 'SettingsShell appear/zoom-in (#86 gap)',
      file: 'src/components/settings/v2/SettingsShell.tsx',
      requireMotionReduce: /motion-reduce:/,
    },
  ];

  for (const surface of surfaces) {
    it(`${surface.name} has a reduced-motion guard`, () => {
      const src = read(surface.file);
      let satisfied = false;
      if (surface.requireUseReducedMotion) {
        const usesHook = /from\s+["']@\/hooks\/useReducedMotion["']/.test(src);
        if (usesHook) satisfied = true;
      }
      if (surface.requireMotionReduce) {
        const pattern =
          surface.requireMotionReduce === true
            ? /motion-reduce:/
            : surface.requireMotionReduce;
        if (pattern.test(src)) satisfied = true;
      }
      expect(
        satisfied,
        `Expected ${surface.file} to honor prefers-reduced-motion via ` +
          `useReducedMotion() and/or a motion-reduce: variant. ` +
          `Add one of those guards or update this test.`,
      ).toBe(true);
    });
  }
});

describe('Reduced-motion sweep (#86) — useFadeOnType hook', () => {
  it('useFadeOnType.ts consults prefers-reduced-motion', () => {
    const src = read('src/hooks/useFadeOnType.ts');
    expect(src).toMatch(/prefers-reduced-motion/);
    expect(src).toMatch(/matchMedia/);
  });
});

describe('Reduced-motion sweep (#86) — useFocusMode hook', () => {
  it('useFocusMode.ts documents the CSS @media coverage', () => {
    // Focus mode's transitions are CSS-only and the @media block above is
    // already verified. The hook itself doesn't need a JS gate, but the
    // file should reference the contract so future maintainers know.
    const src = read('src/hooks/useFocusMode.ts');
    expect(src).toMatch(/prefers-reduced-motion/);
  });
});
