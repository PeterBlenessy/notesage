import { invoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Shared types for Copilot LSP inline completions (ProseMirror + CodeMirror)
// ---------------------------------------------------------------------------

export interface InlineCompletionItem {
  insert_text: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  command?: { command: string; arguments?: unknown[] };
}

export interface CompletionCommand {
  command: string;
  arguments?: unknown[];
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Strip the already-typed prefix from a completion item's insert text.
 * The LSP returns a range + full replacement text — the portion between
 * range.start and the cursor has already been typed.
 */
export function stripTypedPrefix(insertText: string, character: number, rangeStartCharacter?: number): string {
  if (rangeStartCharacter === undefined) return insertText;
  const alreadyTypedLen = character - rangeStartCharacter;
  if (alreadyTypedLen > 0 && alreadyTypedLen < insertText.length) {
    return insertText.slice(alreadyTypedLen);
  }
  return insertText;
}

/**
 * Request inline completions from the Copilot LSP and process the response.
 * Returns the ghost text string and optional command, or null if no completion.
 */
export async function requestCopilotCompletion(
  uri: string,
  line: number,
  character: number,
  version: number,
): Promise<{ text: string; command?: CompletionCommand } | null> {
  const items = await invoke<InlineCompletionItem[]>('copilot_lsp_request_completion', {
    uri,
    line,
    character,
    version,
  });

  if (!items || items.length === 0) return null;

  const item = items[0];
  const text = stripTypedPrefix(item.insert_text, character, item.range?.start.character);
  if (!text) return null;

  // Notify LSP the completion was shown
  invoke('copilot_lsp_did_show_completion', {
    item: {
      insertText: item.insert_text,
      range: item.range,
      command: item.command,
    },
  }).catch(() => {
    // Expected: fire-and-forget LSP notification — LSP may be shutting down
  });

  return {
    text,
    command: item.command ? {
      command: item.command.command,
      arguments: item.command.arguments ?? undefined,
    } : undefined,
  };
}

/**
 * Notify the LSP that a completion was accepted (for telemetry/learning).
 */
export function notifyCompletionAccepted(command: CompletionCommand): void {
  invoke('copilot_lsp_accept_completion', {
    command: command.command,
    arguments: command.arguments ?? [],
  }).catch(() => {
    // Expected: fire-and-forget LSP telemetry — LSP may be shutting down
  });
}
