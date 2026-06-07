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
import { trackEvent } from "@aptabase/tauri";
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

/** Where a skill / MCP server was sourced from (skill_invoked, mcp_tool_called). */
export type ItemSource = "bundled" | "user" | "project";

/**
 * Named feature surfaces (feature_used). Closed union by design — extend it
 * deliberately when instrumenting a new surface rather than passing free text.
 */
export type FeatureName =
  | "focus_mode"
  | "cmd_bar_pin"
  | "recording"
  | "source_mode"
  | "print_layout"
  | "command_bar";

/**
 * The full telemetry taxonomy: event name → its required, typed props.
 * Adding an event means adding a key here; the call site is then type-checked.
 */
export interface TelemetryEventProps {
  app_launched: { version: string; os: string; channel: "stable" | "alpha" };
  document_opened: { format: DocumentFormat };
  ai_chat_sent: { path: AiPath; provider_kind: ProviderKind };
  ai_action_used: { action: AiAction };
  export_performed: { format: ExportFormat; template: string };
  connection_added: { provider_kind: ProviderKind };
  skill_invoked: { source: ItemSource };
  mcp_tool_called: { source: ItemSource };
  feature_used: { feature: FeatureName };
}

/** Allowed event names. */
export type TelemetryEvent = keyof TelemetryEventProps;

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
    // The plugin command accepts string-valued props; our taxonomy is all
    // string enums. Send exactly the typed props — nothing appended.
    void trackEvent(event, props as Record<string, string>);
  } catch {
    /* swallow — telemetry is best-effort and must never surface to the user */
  }
}
