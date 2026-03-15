// Shared constants for AI commands.
// Single source of truth — all other files import from here.

// -- Default models --
pub const DEFAULT_MODEL_ANTHROPIC: &str = "claude-sonnet-4-5-20250929";
pub const DEFAULT_MODEL_OPENAI: &str = "gpt-4o";
pub const DEFAULT_MODEL_OLLAMA: &str = "llama3.2";

// -- API versions --
pub const ANTHROPIC_API_VERSION: &str = "2023-06-01";
pub const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

// -- Thinking/reasoning fallback tags (custom/unknown models only) --
// Catalog models use their `thinking_tags` metadata instead (see model-catalog-expansion PRD).
// This fallback is used when no catalog entry exists and /props detection yields nothing.
pub const FALLBACK_THINKING_TAGS: &[(&str, &str)] = &[
    ("<think>", "</think>"),
    ("<summary>", "</summary>"),
    ("<discussion>", "</discussion>"),
    ("<reflection>", "</reflection>"),
    ("<reasoning>", "</reasoning>"),
    ("<scratchpad>", "</scratchpad>"),
    ("<internal_thoughts>", "</internal_thoughts>"),
];

// -- macOS fallback binary paths --
// Primary resolution uses shell_path.rs (spawns login shell for PATH).
// These are last-resort fallbacks when PATH lookup fails.
pub const MACOS_FALLBACK_BIN_PATHS: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
];
pub const MACOS_FALLBACK_NODE_MODULE_PATHS: &[&str] = &[
    "/opt/homebrew/lib/node_modules/.bin",
    "/usr/local/lib/node_modules/.bin",
];

// -- AI tuning parameters --
pub const FIM_TEMPERATURE: f64 = 0.1;
pub const CHAT_TEMPERATURE_FIM_FALLBACK: f64 = 0.2;
pub const REPEAT_PENALTY: f64 = 1.1;

// -- Web search --
pub const ANTHROPIC_WEB_SEARCH_TOOL: &str = "web_search_20250305";
pub const ANTHROPIC_WEB_SEARCH_MAX_USES: u32 = 5;
pub const OPENAI_WEB_SEARCH_TOOL: &str = "web_search_preview";
