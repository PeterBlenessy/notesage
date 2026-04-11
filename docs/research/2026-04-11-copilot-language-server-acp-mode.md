# Research: copilot-language-server --acp Mode vs Copilot CLI

**Date:** 2026-04-11  **Status:** Complete — not viable

## Question

Can `copilot-language-server --acp` replace the separate `@github/copilot` CLI package for chat and agent tasks, and would it return the full model list?

## Background

There are two separate npm packages for GitHub Copilot:

| Package | Binary | Version | Description |
| --- | --- | --- | --- |
| `@github/copilot-language-server` | `copilot-language-server` | 1.467.0 | Language server (LSP + ACP modes) |
| `@github/copilot` | `copilot` | 1.0.15 | Copilot CLI coding agent |

The `copilot-language-server` binary supports both `--stdio` (LSP mode) and `--acp` (ACP mode) as documented in the [official README](https://github.com/github/copilot-language-server-release).

The motivation was to simplify by using a single binary for both inline completions (LSP) and chat/agent tasks (ACP), removing the need for the separate CLI package.

## Test Results

Tested `copilot-language-server --acp` model listing by spawning the binary, authenticating via `github_oauth` with the existing OAuth token, and calling `session/new`.

### Model comparison

| Path | Models returned |
| --- | --- |
| **Copilot CLI** (`@github/copilot --acp`) | 20+ models (Claude Sonnet 4.6, 4.5, 4, Opus 4.6, Haiku 4.5, GPT-5.x series, GPT-4.1, o4-mini, Gemini, etc.) |
| **Language server LSP** (`copilot-language-server --stdio`, `copilot/models`) | 6 models (gpt-5-mini, claude-haiku-4.5, gpt-41-copilot, gpt-4.1, gpt-4o, auto) |
| **Language server ACP** (`copilot-language-server --acp`, `session/new`) | **3 models** (gpt-5-mini, gpt-4.1, claude-haiku-4.5) |

### Key findings

1. `copilot-language-server --acp` returns **fewer** models than the LSP mode, not more
2. The `@github/copilot` CLI is a different package with a different codebase — it has full model access
3. The model limitation is in the `copilot-language-server` binary itself, in both LSP and ACP modes
4. The LSP's `copilot/models` endpoint filters through a `ChatModelFamily` enum (hardcoded allowlist in the binary's source)
5. The ACP mode likely has a similar or even more restrictive filter
6. Even on the latest version (1.467.0, released 2026-04-10), the limitation persists

### Additional observations

- ACP protocol field names differ between the CLI and language server (`authenticationMethods` vs `authMethods`, `method` vs `methodId`)
- The language server ACP mode identifies as "GitHub Copilot 1.467.0" while the CLI identifies as "Copilot 1.0.24"
- `GH_COPILOT_TOKEN` env var can pre-seed auth, avoiding the interactive OAuth flow

## Conclusion

**Not viable.** Switching from the Copilot CLI to `copilot-language-server --acp` would reduce available models from 20+ to 3. The two packages serve different purposes and the CLI cannot be replaced by the language server.

The current architecture is correct:
- **CLI connection** (`@github/copilot --acp`): primary path, full model access via ACP
- **LSP connection** (`copilot-language-server --stdio` + `conversation/*`): fallback for environments where the CLI is unavailable, 6 models
- **Inline completions**: from the LSP instance, works independently
