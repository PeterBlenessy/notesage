# Release v0.64.0

**Date:** 2026-11-25
**Previous version:** 0.63.0

MCP servers work. Until now a server you added could not be reached by any
chat, and most could not be added at all. This release also makes the Settings
button in the sidebar clickable again, keeps the line you are writing above the
command bar, and shows when your library is being indexed.

## Changes

### Features

- **MCP tools in chat.** Tools from the MCP servers you have switched on are now
  available when you chat with an AI provider, with the built-in local AI and
  with GitHub Copilot. The first time a tool is used you are asked for
  permission, and you can allow it once, for the session, or always.
- **MCP servers for coding agents.** Your servers are passed on to agents such
  as Claude Code, Gemini CLI, Codex and Goose when an agent session starts.
- **Indexing is visible.** While your library is being indexed, a thin progress
  bar appears at the bottom of the sidebar, and Tags, Mentions and search say
  that results may still be incomplete.

### Improvements

- Adding an MCP server is more forgiving. You can paste a whole command line,
  folders with spaces in their names work, and you can save a server without
  testing it first. A first start is given two minutes, since it may need to
  download the server.
- A server you add is switched on straight away, and servers you switched on
  earlier start when the app opens.
- If a server stops or fails to start, the app tells you, shows what the server
  printed, and tries again by itself a few times.
- Remote MCP servers can be given an API key or other headers, stored in your
  keychain if you choose.
- Importing servers finds the current Claude Desktop and VS Code settings
  files, and keeps remote servers intact.
- A mistake in one entry of the MCP settings file no longer hides all your
  other servers; the entry is listed with the reason it could not be read.
- A project you add, rename or move is searchable straight away, without
  restarting the app.
- Large saved web pages open faster, and going back to a page you just read is
  instant.

### Fixes

- When you typed past the bottom of the window, the line you were writing
  slipped behind the command bar. It now stays above it, whether you type,
  paste or move down with the arrow keys.
- The Settings button at the bottom of the sidebar could not be clicked when
  translucent chrome was switched on, because the word count was drawn on top
  of it.
- MCP servers started with `npx`, `uvx`, `node`, `python` or `docker` never
  connected.
- Some ordinary server commands, such as one ending in `-p 8080`, were refused
  as unsafe.
- A server that had stopped could still be shown as running.
- Tag and mention counts could be doubled for projects outside your Notesage
  folder.

## Known limits

- When an agent starts an MCP server itself, a server that has to be downloaded
  first (`npx -y …`, `uvx …`) may fail inside the agent's sandbox. Servers that
  are already installed work, and so does using the server from normal chat.
- Remote servers that only support the older SSE connection type are not
  supported yet.
