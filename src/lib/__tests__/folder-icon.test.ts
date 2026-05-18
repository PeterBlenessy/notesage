// @vitest-environment node

/**
 * Regression-lock for src/lib/folder-icon.ts — the single resolver
 * that maps folder structural types to icon components and aria-labels.
 *
 * Issue #139: Adopt folder-only user vocabulary and structural icon system.
 */

import { describe, it, expect } from 'vitest';
import { resolveFolderIcon } from '../folder-icon';

describe('resolveFolderIcon', () => {
  describe('standard folder', () => {
    it('returns a non-null icon component for a standard folder', () => {
      const result = resolveFolderIcon({ type: 'standard' });
      expect(result.icon).not.toBeNull();
    });

    it('returns aria-label communicating it is a folder', () => {
      const result = resolveFolderIcon({ type: 'standard', name: 'my-project' });
      expect(result.ariaLabel.toLowerCase()).toContain('folder');
    });

    it('returns different icon for expanded vs collapsed standard folder', () => {
      const collapsed = resolveFolderIcon({ type: 'standard', expanded: false });
      const expanded = resolveFolderIcon({ type: 'standard', expanded: true });
      // icon name / displayName should differ
      expect(collapsed.icon).not.toBe(expanded.icon);
    });
  });

  describe('locked folder', () => {
    it('returns a non-null icon component for a locked folder', () => {
      const result = resolveFolderIcon({ type: 'locked' });
      expect(result.icon).not.toBeNull();
    });

    it('returns aria-label that communicates the locked state', () => {
      const result = resolveFolderIcon({ type: 'locked', name: 'secret-project' });
      const label = result.ariaLabel.toLowerCase();
      expect(label).toMatch(/lock|locked/);
    });

    it('returns aria-label that still uses "folder" vocabulary', () => {
      const result = resolveFolderIcon({ type: 'locked', name: 'secret-project' });
      const label = result.ariaLabel.toLowerCase();
      expect(label).toContain('folder');
    });

    it('does NOT return "vault" in aria-label', () => {
      const result = resolveFolderIcon({ type: 'locked', name: 'secret-project' });
      const label = result.ariaLabel.toLowerCase();
      expect(label).not.toContain('vault');
    });
  });

  describe('external folder', () => {
    it('returns a non-null icon component for an external folder', () => {
      const result = resolveFolderIcon({ type: 'external' });
      expect(result.icon).not.toBeNull();
    });

    it('returns aria-label that communicates the external/imported nature', () => {
      const result = resolveFolderIcon({ type: 'external', name: 'downloads' });
      const label = result.ariaLabel.toLowerCase();
      // Must mention either "external" or "imported" or "opened" — something that
      // distinguishes it from a project folder
      expect(label).toMatch(/external|import|open/);
    });

    it('returns aria-label that still uses "folder" vocabulary', () => {
      const result = resolveFolderIcon({ type: 'external', name: 'downloads' });
      const label = result.ariaLabel.toLowerCase();
      expect(label).toContain('folder');
    });

    it('does NOT return "external folder" as the displayed noun in aria-label (icon carries the distinction)', () => {
      const result = resolveFolderIcon({ type: 'external', name: 'downloads' });
      const label = result.ariaLabel;
      // The displayed noun must be "folder", not "external folder" as a compound noun
      // This means we should NOT have "external folder" as two words where "external" modifies "folder" as the displayed noun
      // We want aria-label to say e.g. "External folder: downloads" or "Folder (external): downloads" NOT just "external folder"
      // The rule: aria-label must contain "folder" and must communicate external-ness, but not as a bare compound noun
      // Simple check: no occurrence of exactly "external folder" as a standalone label
      expect(label.toLowerCase()).not.toBe('external folder');
    });

    it('returns a different icon than standard folder to provide visual distinction', () => {
      const externalResult = resolveFolderIcon({ type: 'external' });
      const standardResult = resolveFolderIcon({ type: 'standard' });
      expect(externalResult.icon).not.toBe(standardResult.icon);
    });
  });

  describe('name parameter', () => {
    it('includes the folder name in the aria-label when provided', () => {
      const result = resolveFolderIcon({ type: 'standard', name: 'my-docs' });
      expect(result.ariaLabel).toContain('my-docs');
    });

    it('works without a name (anonymous folder)', () => {
      expect(() => resolveFolderIcon({ type: 'standard' })).not.toThrow();
    });
  });
});
