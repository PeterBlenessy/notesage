/**
 * Telemetry — usage analytics helper (Stream A, Aptabase).
 *
 * Every usage event in the app flows through {@link track}. The helper:
 *  - **no-ops when the effective usage flag is off** (channel-derived or an
 *    explicit user opt-out — see `selectEffectiveTelemetryUsage`), so a single
 *    gate covers the entire taxonomy;
 *  - enforces the **fixed, low-cardinality event taxonomy at the type level** —
 *    each event has a closed set of enum-valued props. No free text, no paths,
 *    no document content, no PII (provider *kind*, not name/url; format, not
 *    path). The payload sent is exactly the typed props — nothing is appended —
 *    so the PII/allow-list guard in the backend tests stays exact.
 *
 * Egress is owned by the Rust `tauri-plugin-aptabase` plugin (batching, offline
 * queue, retry). This module only decides *whether* and *what* to emit.
 *
 * PRD: docs/prds/2026-06-07-telemetry.md
 */
import {
  useSettingsStore,
  selectEffectiveTelemetryUsage,
} from "@/stores/settings-store";

/** File kinds the editor can open (document_opened). */
export type DocumentFormat =
  | "md"
  | "epub"
  | "pdf"
  | "docx"
  | "pptx"
  | "code"
  | "image"
  | "text";

/** Which of the four AI routing paths handled a chat send (ai_chat_sent). */
export type AiPath = "direct" | "acp" | "copilot_lsp" | "local_bundled";

/**
 * Provider *kind* — never the user-facing name, label, or URL. Maps from a
 * connection's provider/type, kept deliberately coarse and low-cardinality.
 */
export type ProviderKind =
  | "anthropic"
  | "openai"
  | "ollama"
  | "local"
  | "local_bundled"
  | "openai_compatible"
  | "agent_managed"
  | "copilot_lsp";

/** Bubble-menu AI actions (ai_action_used). */
export type AiAction = "improve" | "summarize" | "expand";

/** Export targets (export_performed). */
export type ExportFormat = "pdf" | "docx" | "pptx" | "html";

/**
 * Built-in export template names (export_performed). Closed set — user-uploaded
 * templates carry arbitrary, PII-bearing filenames and MUST be collapsed to
 * `"custom"` at the call site rather than sent verbatim.
 */
export type ExportTemplate =
  | "clean"
  | "academic"
  | "report"
  | "simple"
  | "business"
  | "custom";

/**
 * Where a skill / MCP server was sourced from (skill_invoked, mcp_tool_called).
 * Only `user` / `project` are distinguishable today — bundled meta-skills are
 * extracted into the global Notesage dir and report as `user`, so there is no
 * separate `bundled` signal to emit.
 */
export type ItemSource = "user" | "project";

/**
 * Named feature surfaces (feature_used). Closed union by design — extend it
 * deliberately when instrumenting a new surface rather than passing free text.
 * Only values with a live `track("feature_used", …)` call site belong here.
 */
export type FeatureName = "focus_mode" | "cmd_bar_pin" | "recording";

/**
 * The full telemetry taxonomy: event name → its required, typed props.
 * Adding an event means adding a key here; the call site is then type-checked.
 */
export interface TelemetryEventProps {
  app_launched: { version: string; os: string; channel: "stable" | "alpha" };
  document_opened: { format: DocumentFormat };
  ai_chat_sent: { path: AiPath; provider_kind: ProviderKind };
  ai_action_used: { action: AiAction };
  export_performed: { format: ExportFormat; template: ExportTemplate };
  connection_added: { provider_kind: ProviderKind };
  skill_invoked: { source: ItemSource };
  mcp_tool_called: { source: ItemSource };
  feature_used: { feature: FeatureName };
}

/** Allowed event names. */
export type TelemetryEvent = keyof TelemetryEventProps;

/** Coarse OS bucket for `app_launched` — never the full UA string. */
export type OsBucket = "macos" | "windows" | "linux" | "other";

/**
 * Derive a coarse, low-cardinality OS bucket from `navigator`. Returns only the
 * four buckets — never the raw UA string (PII / high-cardinality). Uses
 * `navigator.platform` (deprecated but still the most reliable coarse signal in
 * the embedded WebKit view); switch to `navigator.userAgentData.platform` (UACH)
 * when Tauri's WebKit supports it. Safe in any environment (missing navigator →
 * "other").
 */
export function coarseOs(): OsBucket {
  const nav: Partial<Navigator> =
    typeof navigator !== "undefined" ? navigator : {};
  const ua = `${nav.userAgent ?? ""} ${nav.platform ?? ""}`.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "other";
}

/**
 * Map a connection's provider + auth method to a coarse {@link ProviderKind}.
 * Kept here so call sites stay one-liners and the mapping has a single home.
 * Deliberately collapses every `agent_managed` provider (Claude Code, Codex,
 * Copilot CLI, Gemini CLI) into the single `agent_managed` kind — the provider
 * brand is not part of the low-cardinality taxonomy.
 */
export function providerKind(
  provider: string,
  authMethod: string,
): ProviderKind {
  if (authMethod === "agent_managed") return "agent_managed";
  if (authMethod === "local_bundled") return "local_bundled";
  if (authMethod === "local") return provider === "ollama" ? "ollama" : "local";
  // api_key (or anything else): use the provider where it's a known kind.
  switch (provider) {
    case "anthropic":
      return "anthropic";
    case "openai":
      return "openai";
    case "openai_compatible":
      return "openai_compatible";
    case "ollama":
      return "ollama";
    default:
      // Intentional: an unrecognized api_key provider buckets as the generic
      // `local` kind rather than leaking its raw provider string. If a new
      // first-class provider is added, give it its own case above.
      return "local";
  }
}

/**
 * Record a usage event. No-ops silently when usage telemetry is off; never
 * throws into the caller (telemetry must never break a user action).
 *
 * @example track("document_opened", { format: "md" })
 */
export function track<E extends TelemetryEvent>(
  event: E,
  props: TelemetryEventProps[E],
): void {
  try {
    if (!selectEffectiveTelemetryUsage(useSettingsStore.getState())) return;
    // Lazy-load the Aptabase SDK only when an event actually fires. The package
    // eagerly pulls in @tauri-apps/api v1, whose path/os-check runs at import
    // time and throws outside a Tauri/browser context (e.g. node-env unit
    // tests). A dynamic import keeps that side effect out of every module that
    // merely imports a telemetry call site, and out of no-telemetry sessions
    // entirely. The plugin command accepts string-valued props; our taxonomy is
    // all string enums, so send exactly the typed props — nothing appended.
    void import("@aptabase/tauri")
      .then(({ trackEvent }) => trackEvent(event, props as Record<string, string>))
      .catch(() => {
        /* best-effort — telemetry must never surface to the user */
      });
  } catch {
    /* selector/store access failed — ignore */
  }
}
