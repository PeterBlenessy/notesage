/**
 * folder-icon.ts — Single resolver for folder icon + aria-label.
 *
 * Issue #139: Adopt folder-only user vocabulary and structural icon system.
 * Issue #140: Per-folder icon and color customization.
 *
 * The "folder" noun is always the displayed label. Structural meaning
 * (locked / external) is communicated through:
 *   1. A distinct icon component from lucide-react.
 *   2. An aria-label modifier ("Locked folder: …", "External folder: …").
 *
 * Custom appearance (icon + color) is a user-opt-in layer that overrides
 * the structural default for `standard` and `external` folders. Locked
 * folders ignore appearance — security state cannot be skinned away.
 *
 * This module is the single source of truth consumed by both Classic
 * Layout sidebar (FileTreeItem, ProjectItem) and Quiet Composer sidebar
 * (ProjectsSection, FoldersSection). Callers should never inline their
 * own icon/aria-label logic for folder rows.
 */

import {
  Folder, FolderOpen, FolderLock, FolderSymlink,
  // Curated icon set
  Star, Heart, Zap, Moon, Sun, Cloud, Coffee, Music,
  Book, BookOpen, Camera, Video, Code, Terminal, Cpu, Database,
  Globe, Map, Navigation, Compass,
  Briefcase, Building, Home, Archive,
  Leaf, Trees, Flame, Droplets,
  BarChart2, LineChart, PieChart, TrendingUp,
  ShoppingCart, Tag, Gift, Package,
  Puzzle, Lightbulb, Rocket, Shield,
  Mail, Phone,
  // AI / agentic group
  Brain, Bot, Sparkles, Atom,
  type LucideIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Curated icon set (44 icons)
// ---------------------------------------------------------------------------

export interface CuratedFolderIcon {
  name: string;
  icon: LucideIcon;
}

/**
 * The curated icon set available in the FolderAppearancePicker.
 * Groups: personal, productivity, nature, finance/charts, shopping/misc,
 * communication, AI/agentic. Icon names match the lucide-react export names
 * exactly so the picker can round-trip selections through `iconName`.
 */
export const CURATED_FOLDER_ICONS: CuratedFolderIcon[] = [
  // Personal / lifestyle
  { name: 'Star', icon: Star },
  { name: 'Heart', icon: Heart },
  { name: 'Zap', icon: Zap },
  { name: 'Moon', icon: Moon },
  { name: 'Sun', icon: Sun },
  { name: 'Cloud', icon: Cloud },
  { name: 'Coffee', icon: Coffee },
  { name: 'Music', icon: Music },
  // Reading / media
  { name: 'Book', icon: Book },
  { name: 'BookOpen', icon: BookOpen },
  { name: 'Camera', icon: Camera },
  { name: 'Video', icon: Video },
  // Tech / dev
  { name: 'Code', icon: Code },
  { name: 'Terminal', icon: Terminal },
  { name: 'Cpu', icon: Cpu },
  { name: 'Database', icon: Database },
  // Navigation / place
  { name: 'Globe', icon: Globe },
  { name: 'Map', icon: Map },
  { name: 'Navigation', icon: Navigation },
  { name: 'Compass', icon: Compass },
  // Work / organization
  { name: 'Briefcase', icon: Briefcase },
  { name: 'Building', icon: Building },
  { name: 'Home', icon: Home },
  { name: 'Archive', icon: Archive },
  // Nature
  { name: 'Leaf', icon: Leaf },
  { name: 'Trees', icon: Trees },
  { name: 'Flame', icon: Flame },
  { name: 'Droplets', icon: Droplets },
  // Finance / charts
  { name: 'BarChart2', icon: BarChart2 },
  { name: 'LineChart', icon: LineChart },
  { name: 'PieChart', icon: PieChart },
  { name: 'TrendingUp', icon: TrendingUp },
  // Shopping / tags
  { name: 'ShoppingCart', icon: ShoppingCart },
  { name: 'Tag', icon: Tag },
  { name: 'Gift', icon: Gift },
  { name: 'Package', icon: Package },
  // Misc / ideas
  { name: 'Puzzle', icon: Puzzle },
  { name: 'Lightbulb', icon: Lightbulb },
  { name: 'Rocket', icon: Rocket },
  { name: 'Shield', icon: Shield },
  // Communication
  { name: 'Mail', icon: Mail },
  { name: 'Phone', icon: Phone },
  // AI / agentic
  { name: 'Brain', icon: Brain },
  { name: 'Bot', icon: Bot },
  { name: 'Sparkles', icon: Sparkles },
  { name: 'Atom', icon: Atom },
  // Default folder shapes
  { name: 'Folder', icon: Folder },
  { name: 'FolderOpen', icon: FolderOpen },
];

// ---------------------------------------------------------------------------
// Folder tag color palette (8 colors, issue #140 — "third chromatic carve-out")
// ---------------------------------------------------------------------------

export interface FolderTagColor {
  /** CSS variable name, e.g. `--color-folder-tag-1`. */
  cssVar: string;
  /** Human-readable label for the color picker UI. */
  label: string;
}

/**
 * The 8-color folder tag palette.
 *
 * Colors are referenced via CSS variables (`--color-folder-tag-1` … 8)
 * defined in `globals.css`. Each variable has light + dark variants and is
 * audited at WCAG UI 3:1 non-text contrast against `--color-background` via
 * `pnpm audit:contrast`. Components must use `var(--color-folder-tag-N)` —
 * never hardcode the oklch values here.
 *
 * Permitted usage: sidebar folder icon fill color, FolderAppearancePicker
 * swatches. Forbidden: surfaces, borders, muted chrome, body text,
 * editor content (those have their own semantic palettes).
 */
export const FOLDER_TAG_COLORS: FolderTagColor[] = [
  { cssVar: '--color-folder-tag-1', label: 'Red' },
  { cssVar: '--color-folder-tag-2', label: 'Orange' },
  { cssVar: '--color-folder-tag-3', label: 'Yellow' },
  { cssVar: '--color-folder-tag-4', label: 'Green' },
  { cssVar: '--color-folder-tag-5', label: 'Teal' },
  { cssVar: '--color-folder-tag-6', label: 'Blue' },
  { cssVar: '--color-folder-tag-7', label: 'Purple' },
  { cssVar: '--color-folder-tag-8', label: 'Pink' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The structural type of a folder. */
export type FolderType = 'standard' | 'locked' | 'external';

/**
 * Optional user-set appearance override for a folder.
 * Both fields are nullable independently — the user may set only an icon,
 * only a color, or both.
 */
export interface FolderAppearance {
  /** Name key into CURATED_FOLDER_ICONS, or null for the structural default. */
  iconName: string | null;
  /** 0-based index into FOLDER_TAG_COLORS (0–7), or null for no color. */
  colorIndex: number | null;
}

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
  /**
   * Optional custom appearance override. Applied only to `standard` folders —
   * locked and external folders ignore this to preserve structural semantics.
   */
  appearance?: FolderAppearance;
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
  /**
   * CSS `color` value to apply to the icon, e.g. `var(--color-folder-tag-3)`.
   * Undefined when no custom color is set — callers should apply no inline style.
   */
  color?: string;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolves the icon component, aria-label, and optional color for a folder row.
 *
 * Custom appearance (iconName + colorIndex) overrides the structural default
 * for `standard` and `external` folders. `locked` folders use the fixed
 * `FolderLock` icon regardless of any `appearance` option.
 *
 * @example
 * ```tsx
 * const { icon: Icon, ariaLabel, color } = resolveFolderIcon({
 *   type: 'standard',
 *   name: 'my-project',
 *   appearance: { iconName: 'Star', colorIndex: 2 },
 * });
 * return (
 *   <span aria-label={ariaLabel} style={color ? { color } : undefined}>
 *     <Icon aria-hidden="true" />
 *   </span>
 * );
 * ```
 */
export function resolveFolderIcon(options: FolderIconOptions): FolderIconResult {
  const { type, expanded = false, name, appearance } = options;

  switch (type) {
    case 'locked': {
      const label = name
        ? `Locked folder: ${name}`
        : 'Locked folder';
      // Structural icon — appearance is intentionally ignored.
      return { icon: FolderLock, ariaLabel: label };
    }

    case 'external':
    case 'standard':
    default: {
      const isExternal = type === 'external';
      const label = name
        ? `${isExternal ? 'External folder' : 'Folder'}: ${name}`
        : isExternal ? 'External folder' : 'Folder';

      // Resolve custom icon, if any. External folders default to FolderSymlink
      // (linked-from-elsewhere semantics); standard folders default to the
      // open/closed Folder pair. Custom appearance overrides either.
      const defaultIcon: LucideIcon = isExternal
        ? FolderSymlink
        : expanded ? FolderOpen : Folder;
      let icon = defaultIcon;
      if (appearance?.iconName) {
        const found = CURATED_FOLDER_ICONS.find((c) => c.name === appearance.iconName);
        if (found) icon = found.icon;
      }

      // Resolve custom color, if any.
      let color: string | undefined;
      if (appearance?.colorIndex != null && appearance.colorIndex >= 0 && appearance.colorIndex <= 7) {
        color = `var(${FOLDER_TAG_COLORS[appearance.colorIndex]?.cssVar})`;
      }

      return { icon, ariaLabel: label, color };
    }
  }
}
