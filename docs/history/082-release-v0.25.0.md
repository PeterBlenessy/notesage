# Release v0.25.0

**Date:** 2026-03-29
**Previous version:** 0.24.0

## Changes

### Features
- **Skills-to-tools glue layer** — Script-bearing skills are now automatically exposed as first-class tool definitions so any model with tool-calling support (even small local models) can discover and use them without multi-step meta-reasoning. The extraction pipeline tries explicit YAML frontmatter schemas, Usage comment parsing from script headers, or a generic fallback. Skill tools appear alongside built-in tools and respect agent `allowed-tools` filtering.
- **Tools selector in chat footer** — New popover showing all available tools grouped by Built-in and Skills sections, with "schema"/"auto" badges indicating extraction method. Styled consistently with the provider/agent/project selectors.
- **Conversation branch deletion** — Users can delete a conversation branch from the branch switcher popover via a trash icon. Deleting the active branch auto-switches to a sibling. Deletion is disabled when only one branch remains.
- **Skill tool badges in Settings** — Skills that generated tool definitions show a "N tools" pill badge alongside the existing "scripts" badge (now also rendered as a pill) in Settings > Skills & Agents.

### Fixes
- **Conversation branches lost on app refresh** — `activeLeafId` was optional and not initialized in `createConversation`, so it persisted as `undefined`. On rehydration, the `selectMessages` selector fell through to the legacy "return all messages" path, flattening branches and hiding the branch separator. Fixed by making `activeLeafId` required (`string | null`), initializing it in `createConversation`, and adding a rehydration fixup for existing persisted conversations.
- **Branch separator not displayed** — Root cause was the same `activeLeafId` bug: when undefined, all messages were returned as a flat list, making `allMessages.length === messages.length` which prevented the separator from rendering.
- **Rust dead_code warning** — Suppressed warning on `ToolFrontmatter.name` field which is used for YAML deserialization but not read directly in Rust code.

### Improvements
- Skills converted to tools are excluded from the system prompt text injection to avoid duplicate exposure to the model
- Pretty display names in the tools popover (e.g., "Web Search" instead of `web_search`, "Download Webpage" instead of `skill__download_webpage`)
- Multi-script skills show script name in the tools popover (e.g., "Create Skill — Scaffold")

## Files Changed
- 20+ files changed across 7 commits
- New Tauri command: `extract_skill_tools` for skill-to-tool extraction pipeline
- New Rust types: `SkillToolEntry`, `ArgMapping`, `ArgMappingType`
- New TypeScript types: `SkillToolEntry`, `ArgMapping`, `ArgMappingType`
- New utility: `getDescendants` in `chat-tree.ts`
- New store actions: `setSkillTools`, `getSkillToolByName`, `deleteBranch`
- 48 new tests (14 Rust + 34 frontend)
