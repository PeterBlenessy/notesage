/**
 * Structural tests for the FloatingCommandBar extraction (#412).
 *
 * These tests verify that the god-component has been split into per-file
 * sub-components and a geometry hook. They intentionally RED before the
 * extraction (files don't exist / inline definitions still present) and
 * GREEN after.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Resolve from this test file up to the project root (src/components/cmd/__tests__/)
const projectRoot = path.resolve(import.meta.dirname, '../../../../');

function srcPath(...parts: string[]): string {
  return path.join(projectRoot, 'src', ...parts);
}

const orchestratorPath = srcPath('components', 'cmd', 'FloatingCommandBar.tsx');

describe('FloatingCommandBar sub-component extraction (#412)', () => {
  // -------------------------------------------------------------------------
  // File-existence tests — each extracted sub-component must live in its own
  // file. These fail while the components are still inline.
  // -------------------------------------------------------------------------

  it('resize/PinnedResizeHandle.tsx exists', () => {
    expect(fs.existsSync(srcPath('components', 'cmd', 'resize', 'PinnedResizeHandle.tsx'))).toBe(true);
  });

  it('resize/ExpandedResizeHandle.tsx exists', () => {
    expect(fs.existsSync(srcPath('components', 'cmd', 'resize', 'ExpandedResizeHandle.tsx'))).toBe(true);
  });

  it('resize/TopResizeHandle.tsx exists', () => {
    expect(fs.existsSync(srcPath('components', 'cmd', 'resize', 'TopResizeHandle.tsx'))).toBe(true);
  });

  it('CompactContent.tsx exists', () => {
    expect(fs.existsSync(srcPath('components', 'cmd', 'CompactContent.tsx'))).toBe(true);
  });

  it('ExpandedContent.tsx exists', () => {
    expect(fs.existsSync(srcPath('components', 'cmd', 'ExpandedContent.tsx'))).toBe(true);
  });

  it('PrefixModeBadge.tsx exists', () => {
    expect(fs.existsSync(srcPath('components', 'cmd', 'PrefixModeBadge.tsx'))).toBe(true);
  });

  it('ModePickerDispatch.tsx exists', () => {
    expect(fs.existsSync(srcPath('components', 'cmd', 'ModePickerDispatch.tsx'))).toBe(true);
  });

  it('VerbDiscoveryMenu.tsx exists', () => {
    expect(fs.existsSync(srcPath('components', 'cmd', 'VerbDiscoveryMenu.tsx'))).toBe(true);
  });

  it('hooks/useCommandBarGeometry.ts exists', () => {
    expect(fs.existsSync(srcPath('hooks', 'useCommandBarGeometry.ts'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Inline-definition tests — after extraction the orchestrator must NOT
  // contain bare `function X(` definitions for the extracted components.
  // -------------------------------------------------------------------------

  it('PinnedResizeHandle is not defined inline in FloatingCommandBar.tsx', () => {
    const content = fs.readFileSync(orchestratorPath, 'utf-8');
    expect(content).not.toMatch(/^function PinnedResizeHandle\(/m);
  });

  it('ExpandedResizeHandle is not defined inline in FloatingCommandBar.tsx', () => {
    const content = fs.readFileSync(orchestratorPath, 'utf-8');
    expect(content).not.toMatch(/^function ExpandedResizeHandle\(/m);
  });

  it('TopResizeHandle is not defined inline in FloatingCommandBar.tsx', () => {
    const content = fs.readFileSync(orchestratorPath, 'utf-8');
    expect(content).not.toMatch(/^function TopResizeHandle\(/m);
  });

  it('CompactContent is not defined inline in FloatingCommandBar.tsx', () => {
    const content = fs.readFileSync(orchestratorPath, 'utf-8');
    expect(content).not.toMatch(/^function CompactContent\(/m);
  });

  it('ExpandedContent is not defined inline in FloatingCommandBar.tsx', () => {
    const content = fs.readFileSync(orchestratorPath, 'utf-8');
    expect(content).not.toMatch(/^function ExpandedContent\(/m);
  });

  it('PrefixModeBadge is not defined inline in FloatingCommandBar.tsx', () => {
    const content = fs.readFileSync(orchestratorPath, 'utf-8');
    expect(content).not.toMatch(/^function PrefixModeBadge\(/m);
  });

  it('ModePickerDispatch is not defined inline in FloatingCommandBar.tsx', () => {
    const content = fs.readFileSync(orchestratorPath, 'utf-8');
    expect(content).not.toMatch(/^function ModePickerDispatch\(/m);
  });

  it('VerbDiscoveryMenu is not defined inline in FloatingCommandBar.tsx', () => {
    const content = fs.readFileSync(orchestratorPath, 'utf-8');
    expect(content).not.toMatch(/^function VerbDiscoveryMenu\(/m);
  });

  // -------------------------------------------------------------------------
  // Geometry hook — constants must be exported from the dedicated module.
  // -------------------------------------------------------------------------

  it('useCommandBarGeometry exports PINNED_WIDTH_MIN', () => {
    const content = fs.readFileSync(srcPath('hooks', 'useCommandBarGeometry.ts'), 'utf-8');
    expect(content).toContain('PINNED_WIDTH_MIN');
  });

  it('useCommandBarGeometry exports EXPANDED_WIDTH_DEFAULT', () => {
    const content = fs.readFileSync(srcPath('hooks', 'useCommandBarGeometry.ts'), 'utf-8');
    expect(content).toContain('EXPANDED_WIDTH_DEFAULT');
  });
});
