# Actions Dashboard UI Patterns Research

**Date:** 2026-03-13 **Context:** Evaluating UI patterns for the Open Actions Dashboard (PRD: `docs/prds/2026-03-11-open-actions-dashboard.md`). The current PRD proposes a right sidebar panel. Alternatives under consideration: editor tab, landing page, separate window.

---

## Pattern 1: Panel-Based (Sidebar / Bottom Panel)

### Cursor 2.0 — Agent Sidebar

Cursor 2.0 reorganized its entire UI around agents. The right sidebar shows agent sessions with name, status, and progress. Users toggle between agent-centric and classic file-tree views. Up to eight parallel agents run in isolated git worktrees.

- **Pros:** Agent is the primary work unit, so centering UI on it matches the mental model. Editor stays visible.
- **Cons:** Dedicating the entire right panel to agents means losing it for other uses (chat, file details). The toggle between views is a mode switch that can disorient.
- **Disclosure:** Sidebar shows agent name + status at a glance. Clicking expands plan, output, and file changes.

### Windsurf — Cascade Panel

Right-side panel opened via sidebar icon or keyboard shortcut. Cascade acts as both agent and copilot depending on the task. Contextual bars (preview, deploy) appear only when relevant.

- **Pros:** Single panel for all AI interaction avoids mode confusion.
- **Cons:** Always full-height; no compact summary mode.

### VS Code — Agent Sessions View + Agent Debug Panel (February 2026)

"Agent HQ" implemented as the **Agent Sessions view** — a panel showing multiple background agents. A separate **Agent Debug panel** shows real-time events, tool calls, and loaded customizations.

- **Pros:** Sessions view = lightweight task list (quick glance). Debug panel = deep introspection for power users. Clean separation of "what's happening" from "how it's happening."
- **Disclosure:** Sessions view = status list. Click through = full session log with token usage and session count. Debug panel = real-time event stream.

### GitHub Copilot — Agents Panel (Overlay)

Lightweight overlay available on every page of github.com, opened via header button. Shows delegated tasks with status. "View all" opens a full agents tab.

- **Pros:** Accessible everywhere without navigation. Functions as "mission control" floating above current context.
- **Disclosure:** Panel = compact task list with status badges. "View all" = full-page agents tab with detailed session info. **Two-tier progressive disclosure.**

### Notesage (Current) — Activity Strip + Activity Panel

Narrow 40px activity strip showing per-task status icons, expandable into a resizable sidebar panel (Cmd+Shift+A).

- **Pros:** Strip provides glanceable status without consuming screen real estate. Panel expansion is smooth and doesn't require navigation away from the editor.
- **Disclosure:** Strip = icon-level status. Panel = full details including thinking output and activity log.

---

## Pattern 2: Tab-Based (Opens as a Regular Editor Tab)

### VS Code — Welcome Tab + Agents Tab

VS Code uses tabs for non-editor views: Welcome, Settings, Extension details, and the agents tab (via "View all" from agents panel). Full editor-area tabs that behave like documents but show custom UI.

- **Pros:** Leverages existing mental model of "things I have open." Tab can be pinned, reordered, closed like any other tab. Doesn't consume sidebar or panel space. **Full content area width.**
- **Cons:** Tabs compete with documents for attention and tab bar space. Users with many files open may lose dashboard tabs in the crowd.

### JetBrains — Welcome Screen (Tab-like)

Welcome screen displayed when no project is open. Takes users "straight into the IDE, with no extra dialog windows."

- **Pros:** Fills empty state with actionable content.
- **Cons:** Only visible when nothing is open — cannot serve as ongoing dashboard during work sessions.

---

## Pattern 3: Landing Page / Home Screen

### VS Code Start Page

When all tabs are closed, shows recent files, walkthroughs, and getting-started content.

- **Pros:** Prevents "blank canvas" problem. Natural place for "what needs attention" content.
- **Cons:** Disappears as soon as a file is opened. Cannot serve as a persistent dashboard.

### JetBrains Welcome Screen

Entry point when no project is loaded. Recent projects, cloning, new project creation.

- **Relevance:** A landing page showing open actions when no tabs are open could serve as a "here's what needs your attention" nudge without adding persistent UI chrome.

---

## Pattern 4: Separate Window

### macOS Activity Monitor / iStat Menus

Activity Monitor is a separate window. iStat Menus uses the **menu bar** pattern — tiny indicators that expand into detailed popovers on click.

- **Pros:** Menu bar items are always visible without a window. Click-to-expand is native macOS and well-understood.
- **Disclosure:** Menu bar icon = at-a-glance indicator. Click = detailed popover.

### Docker Desktop Dashboard

Menu bar icon + separate dashboard window showing containers, images, volumes. Window can be closed while Docker continues running in background.

- **Pros:** Dashboard concerns are separate from primary work, so separate window makes sense.
- **Cons:** Separate windows easy to lose behind other apps. Disconnect between menu bar icon and full window creates navigation gap.

### Todoist — Float on Top + Multi-Window

Multiple windows with "Float on Top" mode (Option+Cmd+F) that pins a window above all others.

- **Pros:** Float-on-top keeps tasks visible while working in other apps.
- **Relevance:** A float-on-top actions window could serve users who want persistent task visibility alongside the editor.

### Raycast — Floating Command Window

Floating command window (hotkey-activated) with list/detail layout. Dismisses after use.

- **Pros:** Invoke-dismiss pattern is fast and doesn't permanently consume screen space.

---

## Pattern 5: Hybrid Approaches

### GitHub Copilot — Panel + Tab + GitHub.com

Most sophisticated hybrid found:

1. **Agents panel** (overlay) — quick task delegation and status list
2. **"View all" agents tab** (full page) — detailed session management
3. **VS Code Agent Sessions view** (sidebar panel) — IDE-integrated monitoring
4. **GitHub CLI** — terminal-based session tracking
5. **Raycast extension** — system-wide access

Multi-surface approach lets users interact from whatever context they're in.

### Cursor 2.0 — Sidebar + Background Mode

Agent sidebar (right panel) + "Plan Mode in Background" — agents run without requiring sidebar to be open.

### Notion 3.0 — Inline + Background + Dashboard

Agents work inline (within documents) but can execute in background for up to 20 minutes. Separate AI usage dashboard for credit monitoring.

### VS Code (February 2026) — Five Surfaces

1. Agent Sessions view (panel) — task list with status
2. Agent Debug panel — real-time event stream
3. Agents tab (from GitHub) — full-page session management
4. Chat view — subagent progress with tool calls
5. Status bar — compact indicators

---

## Cross-Cutting Pattern: Progressive Disclosure

The most successful implementations share a three-tier progressive disclosure pattern:

| Tier | What | Where | Examples |
| --- | --- | --- | --- |
| **Glance** | Icon + badge count | Menu bar, status bar, activity strip | Notesage activity strip, iStat Menus, Docker menu bar |
| **Summary** | Task list with status | Sidebar panel, overlay, floating window | GitHub agents panel, VS Code sessions view, Cursor sidebar |
| **Detail** | Full task log, output | Tab, expanded panel, separate page | VS Code debug panel, GitHub "View all" tab |

Transitions between tiers:

- **Glance → Summary:** Click icon/badge to expand panel
- **Summary → Detail:** Click task row to drill into full detail
- **Direct access:** Some apps let you jump directly to detail (Command Palette → "Open Agent Debug Panel")

---

## Evaluation for Notesage

### Option A: Panel (current PRD)

| Dimension | Assessment |
| --- | --- |
| Discoverability | Good — activity strip badge + keyboard shortcut |
| Screen space | Limited — right sidebar is narrow for a dashboard with filters, grouping, and detail |
| Coexistence | Competes with chat panel for the same slot |
| System tray integration | Indirect — tray could show badge, click opens app + panel |
| Progressive disclosure | Good — strip (glance) → panel (summary), but no detail tier |

### Option B: Editor Tab

| Dimension | Assessment |
| --- | --- |
| Discoverability | Moderate — needs keyboard shortcut or command palette entry |
| Screen space | Excellent — full content area width, room for rich filtering and grouping |
| Coexistence | Great — can be open alongside chat panel and other tabs |
| System tray integration | Good — tray click opens app + switches to actions tab |
| Progressive disclosure | Good — status bar (glance) → tab (summary + detail in one view) |

### Option C: Landing Page (when no tabs open)

| Dimension | Assessment |
| --- | --- |
| Discoverability | Great — automatically visible when app starts or all tabs close |
| Screen space | Excellent — full content area |
| Coexistence | Poor — disappears once you open a file. Not accessible during work. |
| System tray integration | Poor — can't show landing page if tabs are open |
| Progressive disclosure | Only one tier — not accessible on demand |

### Option D: Separate Window

| Dimension | Assessment |
| --- | --- |
| Discoverability | Moderate — needs menu item or keyboard shortcut |
| Screen space | Excellent — dedicated window, any size |
| Coexistence | Excellent — visible alongside editor at all times |
| System tray integration | Natural — tray icon click toggles window visibility |
| Progressive disclosure | Good — tray (glance) → window (summary + detail) |

### Option E: Landing Page + Tab Hybrid (Recommended)

| Dimension | Assessment |
| --- | --- |
| Discoverability | Excellent — visible on launch, then accessible as a tab anytime |
| Screen space | Excellent — full content area in both modes |
| Coexistence | Great — tab coexists with chat panel and other tabs |
| System tray integration | Natural — tray click opens app + shows/creates actions tab |
| Progressive disclosure | Three tiers: status bar count (glance) → landing/tab (summary) → click-through (detail) |

---

## Recommendation: Landing Page + Tab Hybrid with Status Bar Indicator

**Chosen approach:** Status bar count + landing page + pinnable editor tab.

**How it works:**

1. **Status bar indicator** (glance tier) — small open-actions count in the status bar left zone (alongside git branch, Local AI, etc.). Clicking it opens/focuses the actions dashboard tab. No activity strip badge needed — the status bar is a more natural, less cluttered home for a count.
2. **Landing page** (discovery tier) — when no tabs are open, the content area shows the actions dashboard automatically. "Here's what needs your attention" on app launch.
3. **Pinnable editor tab** (detail tier) — Cmd+5 or command palette opens the dashboard as a regular editor tab. Can coexist with files, chat panel, everything. Pin to keep it always accessible.
4. **System tray** (future) — tray icon click shows/creates the actions tab.

**Why not the other options:**

- **Panel (current PRD):** Too narrow for project grouping, filters, and action details. Competes with chat panel for the same right-sidebar slot.
- **Landing page only:** Disappears once a file is opened. Useless during active work.
- **Separate window:** Adds multi-window state sync complexity. Worth revisiting if the dashboard grows richer, but overkill for a filtered list view.
- **Activity strip badge:** Overkill for a count indicator — the status bar already has the right visual weight and interaction patterns (click to expand/navigate).

---

## Sources

- [Cursor 2.0 Changelog](https://cursor.com/changelog/2-0)
- [Cursor Parallel Agents](https://cursor.com/docs/configuration/worktrees)
- [VS Code: Multi-Agent Development (Feb 2026)](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development)
- [VS Code: Unified Agent Experience](https://code.visualstudio.com/blogs/2025/11/03/unified-agent-experience)
- [GitHub Blog: Agents Panel](https://github.blog/news-insights/product-news/agents-panel-launch-copilot-coding-agent-tasks-anywhere-on-github/)
- [Windsurf Docs](https://docs.windsurf.com/)
- [Linear: How We Redesigned the UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Notion 3.0: Agents (Sep 2025)](https://www.notion.com/releases/2025-09-18)
- [Things 3 Features](https://culturedcode.com/things/features/)
- [Todoist Multi-Windows](https://www.todoist.com/help/articles/introduction-to-todoist-multi-windows-on-desktop-H9by8jUOH)
- [Docker Desktop Dashboard](https://docs.docker.com/desktop/use-desktop/)
- [Raycast API: User Interface](https://developers.raycast.com/api-reference/user-interface)
- [iStat Menus](https://bjango.com/mac/istatmenus/)