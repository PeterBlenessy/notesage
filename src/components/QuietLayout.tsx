import { TitleBar } from "@/components/TitleBar";
import type { LayoutProps } from "@/components/Layout";

/**
 * QuietLayout — placeholder shell for the Quiet Composer UI refresh
 * (PRD `2026-04-21-ui-refresh`, Phase 1).
 *
 * Mounted only when `settings.uiPreview === "quiet-composer"`. Renders a
 * three-zone scaffold under a TitleBar so subsequent tasks can drop in
 * the real components:
 *
 *   - #30 QuietSidebar  → left zone (240px)
 *   - #48 DocHead etc.  → centre document area
 *   - composer pinned mode → right reserved zone (240px)
 *
 * This file is intentionally a stub. It does NOT mount the editor, chat
 * panel, sidebar, or activity strip — those arrive in later tasks. The
 * placeholder is the point.
 */

export type QuietLayoutProps = LayoutProps;

export function QuietLayout(_props: QuietLayoutProps) {
  // Props are accepted to mirror Layout's signature so the call site at
  // App.tsx → <Layout {...layoutProps} /> works without a per-branch
  // adapter. They will be wired into the real components in later tasks.
  void _props;

  // Inert handlers for the toggle buttons — the real chat panel and
  // activity strip aren't part of the placeholder.
  const noop = () => {};

  return (
    <div
      data-quiet-layout-placeholder
      className="flex flex-col h-screen w-full bg-background overflow-hidden"
    >
      <TitleBar onToggleChat={noop} onToggleActivityStrip={noop} />

      <div className="flex-1 grid min-h-0 gap-2 p-2"
        style={{ gridTemplateColumns: "240px 1fr 240px" }}
      >
        <ZonePlaceholder label="Sidebar (placeholder)" />
        <ZonePlaceholder label="Document area (placeholder)" />
        <ZonePlaceholder label="Reserved (placeholder)" />
      </div>
    </div>
  );
}

interface ZonePlaceholderProps {
  label: string;
}

function ZonePlaceholder({ label }: ZonePlaceholderProps) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 min-h-0">
      <span className="text-muted-foreground text-sm">{label}</span>
    </div>
  );
}
