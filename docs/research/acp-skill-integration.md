# ACP Skill Integration Patterns

**Date:** 2026-04-02\
**Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | — | Not planned |
| Tasks | — | Not planned |

## 1. ACP Protocol: Tool/Skill Mechanisms

### What ACP defines

The Agent Client Protocol (v0.10/0.11, built by JetBrains and Zed) uses JSON-RPC 2.0 over stdio. The protocol defines these core methods:

- `initialize` — negotiate capabilities (client: `readTextFile`, `writeTextFile`, terminals; agent: MCP support, content types, session features)
- `authenticate` — credential exchange
- `session/new` — create session with `cwd` and optional `mcpServers` array
- `session/prompt` — send user content (text, resources, images) to the agent
- `session/update` — agent streams back messages, tool calls, plans, mode changes
- `session/request_permission` — agent asks user to approve a tool call

### There is NO skill injection mechanism in ACP

The ACP spec has **no method for the client to register tools or inject skills into the agent**. Specifically:

- **No** `tools/register` **method** — tools are agent-defined and agent-executed. The client sees tool calls via `session/update` notifications but never defines what tools the agent has.
- **No system prompt injection** — the `session/prompt` method accepts `ContentBlock[]` (text, resources, images) but there is no dedicated system message or context field. The only way to inject context is to prepend it to the user's prompt content.
- **No skill discovery protocol** — skills are entirely a filesystem concern, handled by each agent independently.
- **No** `available_commands` **registration** — slash commands are agent-defined only. The agent advertises them; the client cannot add its own.

### What ACP DOES provide for tool/context flow

1. **MCP server passthrough** (`session/new.mcpServers`): The client can tell the agent to connect to MCP servers (stdio, HTTP, or SSE transport). This is the only mechanism for client-to-agent tool injection — the client specifies MCP server connection details, and the agent connects and discovers tools from those servers.

2. **Embedded context** (`embeddedContext` content type): The client can include file contents directly in prompt messages, allowing context injection without the agent needing filesystem access.

3. **Extensibility** (`_`-prefixed methods, `_meta` fields): Custom methods like `_zed.dev/workspace/buffers` can be defined. No standard skill-related extensions exist yet.

4. **MCP-over-ACP RFD** (proposed, not yet in spec): An RFD proposes adding ACP as an MCP transport, enabling the client to declare MCP servers with `"transport": "acp"`. This would let clients inject project-aware tools directly through the ACP connection without spawning separate processes. Key quote: *"This enables patterns like: A client that injects project-aware tools into every session and handles callbacks directly."* This is not yet implemented.

### Session config options

Session configuration supports only three reserved categories: `mode`, `model`, and `thought_level`. No config option exists for system prompts, tool configuration, or skill injection. Custom categories (prefixed with `_`) are possible but non-standard.

### Key insight

**ACP treats the agent as a black box with its own tools.** The protocol is designed so that agents discover and manage their own tools/skills from the filesystem. The client's role is limited to: (a) showing tool call status to the user, (b) granting/denying permission, and (c) optionally providing MCP server connections.

Sources:

- [ACP Specification](https://agentclientprotocol.com/)
- [ACP GitHub](https://github.com/agentclientprotocol/agent-client-protocol)
- [ACP Tool Calls spec](https://agentclientprotocol.com/protocol/tool-calls)
- [ACP Session Setup](https://agentclientprotocol.com/protocol/session-setup)
- [MCP-over-ACP RFD](https://agentclientprotocol.com/rfds/mcp-over-acp)

## 2. Zed Editor Implementation

### How Zed handles ACP agents

Zed co-created ACP and is the reference client implementation. Based on their documentation and the open GitHub discussion (#50422):

- **Skills are agent-side only.** When using an external ACP agent (Claude Code, Codex, Gemini CLI), the agent discovers skills from its own filesystem paths. Zed does not inject skills into the agent session.
- **Context injection via @-mentions.** Users can @-mention files, directories, symbols, previous threads, rules files, and diagnostics. These are sent as `embeddedContext` content blocks in the prompt.
- **CLAUDE.md is agent-side.** Claude Agent in Zed automatically picks up `CLAUDE.md` files from the project — but this is Claude Code's own behavior, not something Zed orchestrates.
- **Feature gap acknowledged.** GitHub discussion #50422 ("Agent skills in ACP agent") asked how to use `/skills` (available in CLI) within Zed's ACP panel. The discussion was closed without a solution, confirming that Zed does not bridge skills across the ACP boundary.

### What Zed does NOT do

- Does not convert skills to ACP tool definitions
- Does not inject skill descriptions into ACP system prompts
- Does not provide a skill activation tool via MCP
- Does not maintain its own skill registry for ACP agents

### Zed's custom ACP extensions

Zed uses `_`-prefixed extension methods (e.g., `_zed.dev/workspace/buffers`) for editor-specific features, but none relate to skill injection.

Sources:

- [Zed External Agents docs](https://zed.dev/docs/ai/external-agents)
- [Zed ACP page](https://zed.dev/acp)
- [GitHub Discussion #50422](https://github.com/zed-industries/zed/discussions/50422)

## 3. Claude Code ACP Agent

### How Claude Code discovers skills

Claude Code (the CLI, which also runs as `claude-agent-acp`) has the most mature skill implementation:

**Discovery directories (in priority order):**

1. Enterprise managed settings
2. `~/.claude/skills/<name>/SKILL.md` — personal skills
3. `.claude/skills/<name>/SKILL.md` — project skills
4. Plugin skills (namespaced)
5. Nested `.claude/skills/` in subdirectories (monorepo support)
6. `--add-dir` additional directories

**Progressive disclosure:**

1. **Startup:** All skill names + descriptions injected into context (\~50-100 tokens each)
2. **Activation:** Full `SKILL.md` body loaded when the model decides a skill is relevant OR user invokes `/skill-name`
3. **Resources:** Scripts, references, assets loaded on-demand when referenced

**Skill-to-tool mapping:** Skills can be invoked by the model via the `Skill` tool (an internal Claude Code tool, not exposed via ACP). The `Skill(name)` permission syntax controls which skills Claude can invoke.

### How Claude Code operates in ACP mode

When running as `claude-agent-acp`, Claude Code:

- **Discovers skills from its own filesystem** — the same directories as CLI mode
- **Does NOT receive skills from the ACP client** — skills are entirely agent-side
- **Exposes its tools (including skill activation) via ACP tool call updates** — the client sees tool calls but doesn't define them
- **MCP servers from the client** are connected via `session/new.mcpServers`

### Key insight for Notesage

When Notesage spawns `claude-agent-acp`, the agent already has access to `~/.claude/skills/` and project `.claude/skills/`. Any skills in those directories are automatically available. However, **Notesage-specific skills** (in `.notesage/skills/` or `~/.notesage/skills/`) are invisible to the agent because Claude Code doesn't scan those paths.

Sources:

- [Claude Code Skills docs](https://code.claude.com/docs/en/skills)
- [Agent Skills spec](https://agentskills.io/specification)

## 4. Other ACP Clients

### Codex CLI (`codex-acp`)

- Third-party ACP bridge (cola-io/codex-acp) wrapping OpenAI Codex runtime
- **Skill discovery:** Scans `.agents/skills/` (project + parent + repo root), `$HOME/.agents/skills/`, `/etc/codex/skills/`, plus built-in skills
- **Progressive disclosure:** Loads only metadata at startup; full SKILL.md on activation
- **ACP integration:** Automatically launches an internal MCP filesystem server (`acp_fs`) so Codex reads/writes files through ACP tooling. Tools enabled/disabled based on client filesystem capabilities.
- **Does NOT receive skills from the ACP client** — skills are agent-side filesystem discovery
- Optional `agents/openai.yaml` for UI metadata and tool dependencies

### Gemini CLI (`gemini --acp`)

- **Skill discovery:** Three tiers: workspace (`.gemini/skills/` or `.agents/skills/`), user (`~/.gemini/skills/` or `~/.agents/skills/`), extension skills
- **Activation model:** At session start, injects name + description of all skills into system prompt. When model identifies a relevant task, it calls `activate_skill` tool. User sees a confirmation prompt.
- **ACP integration:** MCP servers from the client are connected and their tools made available to the model. Quote: *"Gemini CLI connects to the MCP server, discovers the available tools, and makes them available to the AI model."*
- **Does NOT receive skills from the ACP client** — skills are filesystem-based

### Copilot CLI (`copilot --acp`)

- Limited public documentation on ACP skill integration
- VS Code Copilot (non-ACP) discovers skills from `.github/skills/`, `.claude/skills/`, `.agents/skills/`, `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/`
- Configurable additional locations via `chat.skillsLocations`
- Extensions contribute skills via `chatSkills` contribution point

### JetBrains IDE ACP client

- Supports ACP agents from a registry
- No public documentation on skill injection from IDE to agent

Sources:

- [Codex-ACP GitHub](https://github.com/cola-io/codex-acp)
- [Codex Skills docs](https://developers.openai.com/codex/skills)
- [Gemini CLI ACP Mode](https://geminicli.com/docs/cli/acp-mode/)
- [Gemini CLI Skills](https://geminicli.com/docs/cli/skills/)
- [VS Code Agent Skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

## 5. MCP + ACP Integration

### Current state (in spec)

The only MCP integration in the current ACP spec is **MCP server passthrough** via `session/new`:

```json
{
  "method": "session/new",
  "params": {
    "cwd": "/path/to/project",
    "mcpServers": [
      {
        "name": "my-tools",
        "command": "/usr/local/bin/mcp-server",
        "args": ["--mode", "tools"],
        "env": [{"name": "API_KEY", "value": "..."}]
      }
    ]
  }
}
```

The agent connects to these MCP servers and discovers their tools. This is how a client CAN inject tools — by running an MCP server and passing its connection details to the agent.

### MCP-over-ACP RFD (proposed)

An RFD proposes a new transport type where the client itself acts as an MCP server over the ACP connection:

1. Client declares `"transport": "acp"` in mcpServers with a unique ID
2. Agent sends `mcp/connect` to establish the MCP channel
3. Messages flow bidirectionally via `mcp/message`
4. No separate process needed — tools handled directly by the client

This would enable:

- **Client-injected tools** without spawning MCP server processes
- **WASM-based tools** provided over the ACP channel
- **Transparent bridging** for agents that don't support ACP transport natively

### Practical implication for Notesage

**Today:** Notesage could run an MCP server process that exposes Notesage-specific skills as MCP tools, then pass its connection details via `session/new.mcpServers`. This is architecturally sound but adds process management overhead.

**Future (when MCP-over-ACP ships):** Notesage could expose tools directly over the ACP connection without a separate process.

## 6. The Skill Standard

### Agent Skills (agentskills.io)

The Agent Skills specification, originally developed by Anthropic (December 2025), defines:

- **SKILL.md format:** YAML frontmatter (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`) + markdown body
- **Directory structure:** `skill-name/SKILL.md` + optional `scripts/`, `references/`, `assets/`
- **Progressive disclosure:** 3-tier loading (catalog → instructions → resources)
- **No discovery directories in spec** — the spec defines what goes inside a skill, not where skills live

### Cross-tool discovery convention

The `.agents/skills/` directory has emerged as the cross-client standard:

| Tool | Project skills | User skills |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Codex CLI | `.agents/skills/` | `~/.agents/skills/` |
| Gemini CLI | `.gemini/skills/`, `.agents/skills/` | `~/.gemini/skills/`, `~/.agents/skills/` |
| VS Code Copilot | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/` |
| Notesage | `.notesage/skills/` | `~/.notesage/skills/` |

**All tools also scan** `.agents/skills/` **for cross-client interoperability** (except Notesage, which uses its own `.notesage/skills/` paths).

### Client implementation guide (agentskills.io)

The official guide recommends:

1. **Scan** both client-specific and `.agents/skills/` directories
2. **Parse** SKILL.md with lenient YAML validation
3. **Disclose** name + description in system prompt or tool description (\~50-100 tokens each)
4. **Activate** via file-read tool OR dedicated `activate_skill` tool
5. **Protect** skill content from context compaction
6. **Deduplicate** activations within a session

### Key insight

The skill standard is designed for **agent-side discovery**. Each agent scans its own directories and manages its own skill lifecycle. The standard does NOT define how a host app should make skills available to agents over a protocol like ACP. This is an intentional gap — skills are filesystem-based, and the assumption is that agents and host apps share filesystem access.

Sources:

- [Agent Skills Specification](https://agentskills.io/specification)
- [Client Implementation Guide](https://agentskills.io/client-implementation/adding-skills-support)
- [Anthropic Skills Repository](https://github.com/anthropics/skills)

## 7. Implications for Notesage

### Current architecture

Notesage currently handles skills in two separate paths:

1. **Direct API path:** Skills are injected as system prompt text (descriptions) and converted to tool definitions (`skill__` prefix tools). The model can discover and call skills directly. This works well.

2. **ACP path:** Notesage prepends a system message (including Notesage-specific skill descriptions) to the first `session/prompt`. This is a text-only hint — the ACP agent cannot actually read or execute Notesage skills because:

   - ACP agents discover skills from their own filesystem paths (e.g., `~/.claude/skills/`)
   - Notesage-specific skills live in `.notesage/skills/` which agents don't scan
   - The agent has no tool to load Notesage skill content
   - Skill scripts cannot be executed through ACP

### What should change

#### Short-term (no protocol changes needed)

1. **Scan** `.agents/skills/` **directories.** Add `.agents/skills/` (project-level) and `~/.agents/skills/` (user-level) to Notesage's skill discovery paths. This makes skills installed by Claude Code, Codex, Gemini CLI, and VS Code Copilot visible in Notesage, and vice versa if skills are placed there.

2. **Symlink/copy Notesage skills into agent-visible directories.** When a user installs a skill in Notesage, also place it (or symlink it) in `.agents/skills/` so ACP agents can discover it from the filesystem. This bridges the gap without protocol changes.

3. **Stop injecting skill descriptions into ACP prompts** (or make it optional). ACP agents already do their own skill discovery. Injecting Notesage skill descriptions as prompt text is misleading — the agent sees skill names but cannot load or execute them. It wastes context tokens and may confuse the agent.

#### Medium-term (use MCP passthrough)

4. **Run a Notesage MCP server.** Create a lightweight MCP server (stdio) that exposes Notesage-specific tools:

   - `read_skill_content` — load skill instructions
   - `execute_skill_script` — run skill scripts in Notesage's sandbox
   - `list_skills` — enumerate available skills
   - `search_research` — search the research corpus
   - Any other Notesage-specific capabilities

   Pass this server's connection details via `session/new.mcpServers` when creating ACP sessions. This gives ACP agents access to Notesage's full skill ecosystem through a protocol-standard mechanism.

5. **Consider exposing MCP tools from connected MCP servers.** Notesage already manages MCP server connections. These could be forwarded to ACP agents via `session/new.mcpServers`, giving agents access to all of the user's MCP tools.

#### Long-term (when MCP-over-ACP ships)

6. **Implement MCP-over-ACP transport.** When the RFD is adopted, expose Notesage tools directly over the ACP connection without spawning a separate MCP server process. This is the cleanest architecture.

### What should NOT change

- **Direct API skill-to-tool conversion** works well and should remain as-is. It gives local models (Ollama, local bundled) access to skills as first-class tools.
- **Agent instructions injection** for ACP is reasonable since CLAUDE.md/AGENTS.md patterns are agent-specific. Keep injecting Notesage agent instructions (`.notesage/agents.md`) as they provide role/behavior context that doesn't overlap with agent-side skills.
- **Permission model** — ACP's `session/request_permission` aligns well with Notesage's tiered permission UI. No changes needed.

### Priority recommendation

The highest-impact change is **#1 + #2**: scanning `.agents/skills/` and making Notesage skills visible to ACP agents via the filesystem. This requires minimal code changes (add directories to `discover_skills` in Rust backend) and immediately enables cross-tool skill sharing.

The MCP server approach (#4) is the most architecturally sound for exposing Notesage-specific capabilities to ACP agents, but requires building and maintaining an MCP server component.