/**
 * Run one MCP tool call for a chat tool loop and turn the reply into the
 * plain-text tool result the loops feed back to the model.
 *
 * The backend call (`mcp_call_tool`) cannot be cancelled once it is sent, so
 * Stop works by no longer waiting: the caller's `AbortSignal` settles the
 * returned promise at once and whatever the server answers later is dropped.
 */

import { invoke } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';
import type { McpToolTarget } from './chat-tools';

/** Limit for one `tools/call`, enforced by the backend (its own default). */
export const MCP_TOOL_CALL_TIMEOUT_MS = 300_000;

/** How long past the backend limit the frontend waits before giving up itself. */
const MCP_TOOL_CALL_GRACE_MS = 10_000;

/**
 * Longest tool result text handed to the model. No other tool caps its
 * output today; an MCP server is third-party and can return megabytes, which
 * would overflow any context window in one call.
 */
export const MCP_TOOL_RESULT_MAX_CHARS = 50_000;

export interface McpCallOutcome {
  content: string;
  isError: boolean;
}

export interface McpCallOptions {
  /** Aborted when the turn is stopped: the call resolves immediately. */
  signal?: AbortSignal;
  /** Override {@link MCP_TOOL_CALL_TIMEOUT_MS} (tests). */
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Approximate decoded size of a base64 payload, for the omission note. */
function describeBinary(kind: string, item: Record<string, unknown>): string {
  const mime = typeof item.mimeType === 'string' ? item.mimeType
    : typeof item.mime_type === 'string' ? item.mime_type
    : 'unknown type';
  const data = typeof item.data === 'string' ? item.data : '';
  const size = data ? `, about ${Math.max(1, Math.round((data.length * 3) / 4 / 1024))} KB` : '';
  return `[${kind} omitted: ${mime}${size}. Binary tool output is not passed to the model.]`;
}

/** Cut an oversized result, saying so and by how much. */
export function truncateMcpResultText(text: string, max: number = MCP_TOOL_RESULT_MAX_CHARS): string {
  if (text.length <= max) return text;
  const omitted = text.length - max;
  return `${text.slice(0, max)}\n\n[Result truncated: ${omitted} more characters were omitted.]`;
}

/**
 * Map a `tools/call` result (`content` items of type text / image / audio /
 * resource / resource_link, `isError`, `structuredContent`) to text.
 *
 * Tolerant of both spellings the backend may use (`is_error` / `isError`,
 * `structured_content` / `structuredContent`) and of items it does not know.
 * Images and other binary content are replaced by a note: the tool-result
 * channel of the chat loops is text only.
 */
export function mapMcpToolResult(raw: unknown): McpCallOutcome {
  if (!isRecord(raw)) {
    return { content: 'The MCP server returned an empty result.', isError: false };
  }
  const isError = raw.is_error === true || raw.isError === true;
  const items = Array.isArray(raw.content) ? raw.content : [];
  const parts: string[] = [];

  for (const item of items) {
    if (!isRecord(item)) continue;
    const type = typeof item.type === 'string' ? item.type : '';
    if (type === 'text') {
      if (typeof item.text === 'string' && item.text) parts.push(item.text);
    } else if (type === 'image') {
      parts.push(describeBinary('image', item));
    } else if (type === 'audio') {
      parts.push(describeBinary('audio', item));
    } else if (type === 'resource') {
      const resource = isRecord(item.resource) ? item.resource : item;
      const uri = typeof resource.uri === 'string' ? resource.uri : '';
      if (typeof resource.text === 'string' && resource.text) {
        parts.push(uri ? `[resource ${uri}]\n${resource.text}` : resource.text);
      } else {
        parts.push(`[resource${uri ? ` ${uri}` : ''}: binary content omitted]`);
      }
    } else if (type === 'resource_link') {
      const uri = typeof item.uri === 'string' ? item.uri : '';
      const name = typeof item.name === 'string' ? item.name : '';
      parts.push(`[resource link${name ? ` ${name}` : ''}${uri ? `: ${uri}` : ''}]`);
    } else if (typeof item.text === 'string' && item.text) {
      parts.push(item.text);
    }
  }

  let content = parts.join('\n\n');
  if (!content) {
    const structured = raw.structuredContent ?? raw.structured_content;
    if (structured !== undefined && structured !== null) {
      try {
        content = JSON.stringify(structured, null, 2);
      } catch {
        content = '';
      }
    }
  }
  if (!content) {
    content = isError ? 'The MCP tool reported an error without a message.' : '(the tool returned no content)';
  }
  return { content: truncateMcpResultText(content), isError };
}

/**
 * Call an MCP tool with the server id and ORIGINAL tool name of `target`.
 *
 * Never rejects. A server that is not running, a transport failure, the time
 * limit and a Stop all come back as an error outcome whose text the model
 * can read and act on.
 */
export async function callMcpTool(
  target: McpToolTarget,
  args: Record<string, unknown>,
  options: McpCallOptions = {},
): Promise<McpCallOutcome> {
  const where = `MCP server "${target.serverName}"`;
  if (target.status !== 'running') {
    return {
      content: `${where} is not running (status: ${target.status}), so "${target.toolName}" could not be called. Tell the user the server needs to be started in Settings.`,
      isError: true,
    };
  }
  const { signal } = options;
  if (signal?.aborted) {
    return { content: `MCP tool call cancelled: ${target.toolName}`, isError: true };
  }

  const timeoutMs = options.timeoutMs ?? MCP_TOOL_CALL_TIMEOUT_MS;

  return new Promise<McpCallOutcome>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => settle({ content: `MCP tool call cancelled: ${target.toolName}`, isError: true });
    const settle = (outcome: McpCallOutcome) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    // The backend enforces the limit; this only covers a reply that never
    // comes back over IPC at all.
    timer = setTimeout(() => {
      settle({
        content: `${where} did not answer "${target.toolName}" within ${Math.round(timeoutMs / 1000)} seconds.`,
        isError: true,
      });
    }, timeoutMs + MCP_TOOL_CALL_GRACE_MS);

    invoke<unknown>('mcp_call_tool', {
      serverId: target.serverId,
      toolName: target.toolName,
      arguments: args,
      timeoutMs,
    }).then(
      (raw) => {
        if (settled) {
          log.debug('mcp', `Discarded a late result of ${target.toolName} (call was stopped or timed out)`);
          return;
        }
        settle(mapMcpToolResult(raw));
      },
      (error: unknown) => {
        if (settled) return;
        const message = error instanceof Error ? error.message : String(error);
        settle({
          content: truncateMcpResultText(`${where} could not run "${target.toolName}": ${message}`),
          isError: true,
        });
      },
    );
  });
}
