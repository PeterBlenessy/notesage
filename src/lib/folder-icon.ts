/**
 * folder-icon.ts — Single resolver for folder icon + aria-label.
 *
 * Issue #139: Adopt folder-only user vocabulary and structural icon system.
 *
 * The "folder" noun is always the displayed label. Structural meaning
 * (locked / external) is communicated through:
 *   1. A distinct icon component from lucide-react.
 *   2. An aria-label modifier ("Locked folder: …", "External folder: …").
 *
 * This module is the single source of truth consumed by both Classic
 * Layout sidebar (FileTreeItem, ProjectItem) and Quiet Composer sidebar
 * (ProjectsSection, FoldersSection). Callers should never inline their
 * own icon/aria-label logic for folder rows.
 */

import { Folder, FolderOpen, FolderLock, FolderInput, type LucideIcon } from 'lucide-react';

/** The structural type of a folder. */
export type FolderType = 'standard' | 'locked' | 'external';

export interface FolderIconOptions {
  /** The structural type of the folder. */
  type: FolderType;
  /**
   * Whether the folder is currently expanded (open). Only relevant for
   * `standard` folders — locked and external folders use a fixed icon.
   */
  expanded?: boolean;
  /** Optional display name used to build the aria-label. */
  name?: string;
}

export interface FolderIconResult {
  /**
   * The lucide-react icon component to render. Callers are responsible
   * for passing `aria-hidden="true"` since the aria-label is on the
   * wrapping element.
   */
  icon: LucideIcon;
  /** Accessible label for the wrapping element. */
  ariaLabel: string;
}

/**
 * Resolves the icon component and aria-label for a folder row.
 *
 * @example
 * ```tsx
 * const { icon: Icon, ariaLabel } = resolveFolderIcon({ type: 'locked', name: 'my-project' });
 * return <span aria-label={ariaLabel}><Icon aria-hidden="true" /></span>;
 * ```
 */
export function resolveFolderIcon(options: FolderIconOptions): FolderIconResult {
  const { type, expanded = false, name } = options;

  switch (type) {
    case 'locked': {
      const label = name
        ? `Locked folder: ${name}`
        : 'Locked folder';
      return { icon: FolderLock, ariaLabel: label };
    }

    case 'external': {
      const label = name
        ? `External folder: ${name}`
        : 'External folder';
      return { icon: FolderInput, ariaLabel: label };
    }

    case 'standard':
    default: {
      const icon = expanded ? FolderOpen : Folder;
      const label = name
        ? `Folder: ${name}`
        : 'Folder';
      return { icon, ariaLabel: label };
    }
  }
}
