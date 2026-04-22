import { TitleBar } from "@/components/TitleBar";
import type { LayoutProps } from "@/components/Layout";
import FloatingCommandBar from "@/components/cmd/FloatingCommandBar";
import { AgentOrb } from "@/components/activity/AgentOrb";
import { useSettingsStore } from "@/stores/settings-store";

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

  // When the command bar is pinned (#28), the document column needs to
  // reserve the equivalent right padding so editor content doesn't slide
  // under the side panel. The width comes from the same CSS variable the
  // bar's drag handle drives — sharing the variable means a single source
  // of truth and zero React re-renders during drag.
  const cmdBarPinned = useSettingsStore((s) => s.cmdBarPinned);
  const documentAreaStyle: React.CSSProperties = cmdBarPinned
    ? { paddingRight: "var(--cmd-bar-pinned-width, 400px)" }
    : {};

  return (
    <div
      data-quiet-layout-placeholder
      data-cmd-bar-pinned={cmdBarPinned ? "true" : "false"}
      className="flex flex-col h-screen w-full bg-background overflow-hidden"
    >
      <TitleBar onToggleChat={noop} onToggleActivityStrip={noop} />

      <div
        data-quiet-layout-document-area
        className="flex-1 grid min-h-0 gap-2 p-2"
        style={{
          gridTemplateColumns: "240px 1fr 240px",
          ...documentAreaStyle,
        }}
      >
        <ZonePlaceholder label="Sidebar (placeholder)" />
        <ZonePlaceholder label="Document area (placeholder)" />
        <ZonePlaceholder label="Reserved (placeholder)" />
      </div>

      {/*
        Composer (PRD `2026-04-21-ui-refresh`, tasks #9 + #28). In floating
        mode it portal-mounts to document.body and overlays the workspace at
        the bottom-centre. In pinned mode it renders inline as a fixed-position
        right-edge side panel and the document area above reserves matching
        padding-right via the CSS variable.
       */}
      <FloatingCommandBar />

      {/*
        AgentOrb (PRD `2026-04-21-ui-refresh`, task #29). Fixed-position 46 px
        circle at the bottom-right of the workspace — pulses while
        `activity-store` reports running tasks > 0, hidden when the
        FloatingCommandBar is in pinned mode (the right side panel covers
        the same screen real estate).
       */}
      <AgentOrb />
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
