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
import { invoke } from "@tauri-apps/api/core";
import { log } from "@/lib/logger";
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
export type FeatureName =
  | "focus_mode"
  | "cmd_bar_pin"
  | "recording";

/**
 * Why an agent turn ended (`ai_turn_ended`). Mirrors the ACP `StopReason` wire
 * strings, plus `unknown` for a variant newer than the build.
 *
 * Closed, low-cardinality, and carries nothing about *what* the turn was doing —
 * only how it finished. This is the field signal for the question the local-agent
 * work was built around: how often does an agent actually run out of room for
 * real users, rather than for one person on one task.
 */
export type AiStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled"
  | "unknown";

/**
 * Rich block kinds (block_inserted). Only rich/embedded blocks are tracked —
 * markdown basics (tables, lists, HR) are intentionally excluded. Fired on a
 * deliberate user insert (toolbar / slash / picker / paste), never on parse.
 */
export type BlockKind =
  | "drawing"
  | "chart"
  | "mermaid"
  | "callout"
  | "code_block"
  | "image"
  | "link_preview";

/**
 * Settings whose changes we track (setting_changed). Closed enum — only
 * bounded-value settings are instrumented; settings with unbounded/PII values
 * (paths, widths, margins, numeric caps) are deliberately excluded.
 */
export type SettingKey =
  | "theme"
  | "accent"
  | "quiet_preset"
  | "title_bar"
  | "inline_completions"
  | "external_change_review"
  | "typewriter_scrolling"
  | "print_layout"
  | "tool_calling"
  | "cross_project"
  | "require_all_tool_confirmations"
  | "agent_mode_picker"
  | "release_channel"
  | "telemetry_usage"
  | "telemetry_crash"
  | "log_level";

/**
 * The value a tracked setting was changed to (setting_changed). Closed
 * low-cardinality union across all tracked settings: booleans report `on`/`off`;
 * tri-state telemetry adds `default`; the rest carry each setting's own enum.
 * Never a path, number, or free text.
 */
export type SettingValue =
  | "on"
  | "off"
  | "default"
  | "light"
  | "dark"
  | "system"
  | "orange"
  | "blue"
  | "relaxed"
  | "aggressive"
  | "custom"
  | "stable"
  | "alpha"
  | "error"
  | "warn"
  | "info"
  | "debug";

/**
 * The full telemetry taxonomy: event name → its required, typed props.
 * Adding an event means adding a key here; the call site is then type-checked.
 */
export interface TelemetryEventProps {
  app_launched: { version: string; os: string; channel: "stable" | "alpha" };
  document_opened: { format: DocumentFormat };
  ai_chat_sent: { path: AiPath; provider_kind: ProviderKind };
  /**
   * How an agent turn finished. Complements `ai_chat_sent`, which fires at send
   * and so cannot know the outcome. Only emitted for ACP turns, which are the
   * ones that report a stop reason at all.
   */
  ai_turn_ended: { path: AiPath; provider_kind: ProviderKind; stop_reason: AiStopReason };
  ai_action_used: { action: AiAction };
  export_performed: { format: ExportFormat; template: ExportTemplate };
  connection_added: { provider_kind: ProviderKind };
  skill_invoked: { source: ItemSource };
  mcp_tool_called: { source: ItemSource };
  feature_used: { feature: FeatureName };
  block_inserted: { kind: BlockKind };
  setting_changed: { setting: SettingKey; value: SettingValue };
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
    if (!selectEffectiveTelemetryUsage(useSettingsStore.getState())) {
      // Diagnostic only — never the event props (PII contract); event name is
      // a fixed enum. Lands in the backend log file too (logger forwards).
      log.debug("telemetry", `usage off — skipping "${event}"`);
      return;
    }
    // Egress is owned by the Rust `tauri-plugin-aptabase` plugin. We invoke its
    // `track_event` command directly through the app's own v2 IPC instead of the
    // `@aptabase/tauri` JS guest binding: the only npm-published binding (0.4.1)
    // is pinned to the Tauri *v1* API, whose `invoke` targets the removed v1 IPC
    // global and silently fails under Tauri v2 — so no usage event ever reached
    // the (correctly v2) Rust plugin. The command string + arg shape mirror the
    // plugin's own v2 binding exactly (`{ name, props }`). The plugin enriches
    // each event with OS + app version Rust-side; we send exactly the typed
    // props — nothing appended — so the PII/allow-list guard stays exact.
    // Requires `aptabase:allow-track-event` in capabilities/default.json.
    log.info("telemetry", `track "${event}"`);
    void invoke("plugin:aptabase|track_event", {
      name: event,
      props: props as Record<string, string>,
    })
      .then(() => log.debug("telemetry", `queued "${event}" to the plugin`))
      .catch((e) => {
        // Reaches here only if the command is missing/denied (plugin not
        // registered or capability ungranted). The actual HTTP send happens
        // later inside the plugin's 60s flush — its result is logged Rust-side
        // by the plugin at debug level (raise Log level to Debug to see it).
        log.warn("telemetry", `track "${event}" invoke rejected`, e);
      });
  } catch (e) {
    // Selector/store access failed, or invoke threw synchronously.
    log.warn("telemetry", `track "${event}" threw`, e);
  }
}

/**
 * Convenience wrapper for the common boolean-setting case: emits
 * `setting_changed { setting, value: "on" | "off" }`. Enum settings (theme,
 * accent, channel, …) call {@link track} directly with their own value.
 */
export function trackSettingToggle(setting: SettingKey, enabled: boolean): void {
  track("setting_changed", { setting, value: enabled ? "on" : "off" });
}
