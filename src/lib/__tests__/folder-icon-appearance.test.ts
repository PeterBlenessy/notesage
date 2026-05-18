// @vitest-environment node

/**
 * Unit tests for the custom-appearance extension of folder-icon resolver.
 *
 * Issue #140: Per-folder icon and color customization.
 *
 * Tests that resolveFolderIcon correctly applies custom icon/color overrides
 * when a FolderAppearance is provided, and falls back to structural defaults
 * when no custom appearance is set (no regression).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveFolderIcon,
  FOLDER_TAG_COLORS,
  CURATED_FOLDER_ICONS,
} from '../folder-icon';

describe('resolveFolderIcon — custom appearance', () => {
  describe('icon override', () => {
    it('uses the custom iconName when appearance.iconName is set and matches a curated icon', () => {
      // 'Star' is expected to be in the curated set
      const firstIcon = CURATED_FOLDER_ICONS[0];
      const result = resolveFolderIcon({
        type: 'standard',
        appearance: { iconName: firstIcon.name, colorIndex: null },
      });
      expect(result.icon).toBe(firstIcon.icon);
    });

    it('falls back to the default structural icon when appearance.iconName is null', () => {
      const withCustom = resolveFolderIcon({
        type: 'standard',
        appearance: { iconName: null, colorIndex: null },
      });
      const withoutCustom = resolveFolderIcon({ type: 'standard' });
      expect(withCustom.icon).toBe(withoutCustom.icon);
    });

    it('falls back to the default structural icon when appearance is undefined', () => {
      const result = resolveFolderIcon({ type: 'standard' });
      const withUndefined = resolveFolderIcon({
        type: 'standard',
        appearance: undefined,
      });
      expect(result.icon).toBe(withUndefined.icon);
    });

    it('preserves the locked-folder icon even when a custom iconName is provided', () => {
      // Locked folders have fixed structural icons — custom icons do not override them.
      const firstIcon = CURATED_FOLDER_ICONS[0];
      const withCustom = resolveFolderIcon({
        type: 'locked',
        appearance: { iconName: firstIcon.name, colorIndex: null },
      });
      const withoutCustom = resolveFolderIcon({ type: 'locked' });
      // Locked folder's icon should not change regardless of custom appearance.
      expect(withCustom.icon).toBe(withoutCustom.icon);
    });

    it('overrides the external-folder default icon when a custom iconName is provided', () => {
      const firstIcon = CURATED_FOLDER_ICONS[0];
      const withCustom = resolveFolderIcon({
        type: 'external',
        appearance: { iconName: firstIcon.name, colorIndex: null },
      });
      const withoutCustom = resolveFolderIcon({ type: 'external' });
      // Folder-merge fix: external folders now accept appearance overrides
      // so the user can pick custom icons. Only `locked` folders remain
      // structurally fixed.
      expect(withCustom.icon).not.toBe(withoutCustom.icon);
      expect(withCustom.icon).toBe(firstIcon.icon);
    });
  });

  describe('color override', () => {
    it('returns a CSS variable string when colorIndex is a valid index (0–7)', () => {
      const result = resolveFolderIcon({
        type: 'standard',
        appearance: { iconName: null, colorIndex: 0 },
      });
      expect(result.color).toBeTruthy();
      expect(typeof result.color).toBe('string');
    });

    it('returns undefined for color when appearance is not provided', () => {
      const result = resolveFolderIcon({ type: 'standard' });
      expect(result.color).toBeUndefined();
    });

    it('returns undefined for color when colorIndex is null', () => {
      const result = resolveFolderIcon({
        type: 'standard',
        appearance: { iconName: null, colorIndex: null },
      });
      expect(result.color).toBeUndefined();
    });

    it('returns distinct color values for each valid colorIndex 0–7', () => {
      const colors = [0, 1, 2, 3, 4, 5, 6, 7].map(
        (idx) =>
          resolveFolderIcon({
            type: 'standard',
            appearance: { iconName: null, colorIndex: idx },
          }).color,
      );
      const unique = new Set(colors);
      expect(unique.size).toBe(8);
    });
  });

  describe('regression — no visual change for folders without customization', () => {
    it('standard collapsed folder still returns the default Folder icon when no appearance', () => {
      const result = resolveFolderIcon({ type: 'standard', expanded: false });
      // Should be a non-null icon (regression guard — concrete type tested in folder-icon.test.ts)
      expect(result.icon).not.toBeNull();
      expect(result.color).toBeUndefined();
    });

    it('standard expanded folder still returns the default FolderOpen icon when no appearance', () => {
      const result = resolveFolderIcon({ type: 'standard', expanded: true });
      expect(result.icon).not.toBeNull();
      expect(result.color).toBeUndefined();
    });
  });
});

describe('FOLDER_TAG_COLORS', () => {
  it('exports exactly 8 palette entries', () => {
    expect(FOLDER_TAG_COLORS).toHaveLength(8);
  });

  it('each entry has a cssVar property starting with --color-folder-tag-', () => {
    for (const entry of FOLDER_TAG_COLORS) {
      expect(entry.cssVar).toMatch(/^--color-folder-tag-\d+$/);
    }
  });

  it('each entry has a non-empty label', () => {
    for (const entry of FOLDER_TAG_COLORS) {
      expect(entry.label).toBeTruthy();
    }
  });

  it('all cssVar values are unique', () => {
    const vars = FOLDER_TAG_COLORS.map((e) => e.cssVar);
    expect(new Set(vars).size).toBe(8);
  });
});

describe('CURATED_FOLDER_ICONS', () => {
  it('exports at least 44 icons', () => {
    // Originally locked at 44 (issue #140). The set may grow as new groups
    // are added (e.g. AI/agentic icons). Growth is fine; loss isn't.
    expect(CURATED_FOLDER_ICONS.length).toBeGreaterThanOrEqual(44);
  });

  it('each icon entry has a non-empty name', () => {
    for (const entry of CURATED_FOLDER_ICONS) {
      expect(entry.name).toBeTruthy();
    }
  });

  it('each icon entry has a non-null icon component', () => {
    for (const entry of CURATED_FOLDER_ICONS) {
      expect(entry.icon).not.toBeNull();
    }
  });

  it('all icon names are unique', () => {
    const names = CURATED_FOLDER_ICONS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
