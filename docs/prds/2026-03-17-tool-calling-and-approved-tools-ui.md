# Tool Calling & Approved Tools UI

**Date:** 2026-03-17 **Status:** Superseded by [local-ai-tool-calling](2026-03-11-local-ai-tool-calling.md)

## Problem

The chat footer currently has an interactive "Tools" popover that lets users toggle tool permissions (session/always) for ACP agents. This is unnecessary — agents decide which tools to use, then ask for permission via PermissionCards. The toggle gives an illusion of control without actually restricting what the agent can request.

Additionally, direct API providers (Anthropic, OpenAI, Ollama, Local AI, OpenAI-compatible) currently have no tool calling support. They can only do text-in/text-out. Adding native tool use (function calling) to these providers would enable agentic workflows without requiring ACP agent binaries.

## Goals

1. **Remove the interactive tools popover** from the chat footer — replaced by a read-only display of approved tool pills showing which tools have been approved (session or always), with tooltips explaining each tool
2. **Add native tool calling** to direct API providers using Anthropic's tool_use and OpenAI's function calling APIs — the model requests tools, the user approves via PermissionCards, Notesage executes the tool via Tauri commands, and sends the result back
3. **Unified permission model** — both ACP agents and direct API tool calls use the same PermissionCard approval flow and permission store (session/always tiers)

## Scope

Detailed technical approach, UI/UX design, and data model to be defined when implementation begins.
