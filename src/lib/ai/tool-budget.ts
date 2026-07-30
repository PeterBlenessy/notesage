// Bounding the tool-schema budget for small local context windows.
//
// Every tool definition is serialized into the request, and JSON Schema is
// verbose — a handful of skill tools with nested parameter objects can run to
// thousands of tokens before the user's actual message is considered. On a
// cloud model with a six-figure window that is irrelevant. On a local model at
// 32K it can consume a large share of the budget, which shows up as the model
// losing the plot or the turn overflowing partway through a task.
//
// The remedy is a cap, not a redesign: keep the tools the agent cannot work
// without, then add the rest until the budget runs out — and say what was
// dropped, because a silent cap reads as "everything was available" when it
// wasn't.

import type { ToolDefinition } from './types';
import { estimateTokens } from './context-trim';

/**
 * Share of the context window the tool schemas may occupy.
 *
 * Deliberately modest: the tools are overhead paid on every single turn, and
 * whatever they take is unavailable to the conversation, the files the agent
 * reads, and its own output.
 */
export const TOOL_BUDGET_FRACTION = 0.15;

/**
 * Tools that survive any cap.
 *
 * These are the primitives an agent needs to do anything at all — read, look
 * around, search. Dropping them to make room for a skill would leave a more
 * capable-looking tool list attached to an agent that can no longer function.
 */
const ESSENTIAL_TOOLS = new Set([
  'read_file',
  'list_directory',
  'write_file',
  'web_search',
]);

/** Approximate token cost of one serialized tool definition. */
export function estimateToolTokens(tool: ToolDefinition): number {
  return (
    estimateTokens(tool.name) +
    estimateTokens(tool.description) +
    estimateTokens(JSON.stringify(tool.input_schema ?? {}))
  );
}

export function estimateToolsTokens(tools: ToolDefinition[]): number {
  return tools.reduce((sum, t) => sum + estimateToolTokens(t), 0);
}

export interface ToolBudgetResult {
  /** Tools that fit, essentials first, original order otherwise preserved. */
  tools: ToolDefinition[];
  /** Names dropped for want of budget — logged, never silently discarded. */
  dropped: string[];
  /** Estimated tokens the kept tools cost. */
  estimatedTokens: number;
}

/**
 * Cap a tool list to a token budget.
 *
 * Essentials are admitted first regardless of cost — an agent without
 * `read_file` is not a cheaper agent, it is a broken one — and the remainder
 * are admitted in their given order while they fit. Order is otherwise
 * preserved so callers keep control of priority.
 *
 * A non-positive budget disables capping rather than dropping everything: a
 * caller with no context information should get the unmodified list, not an
 * agent stripped of its tools.
 */
export function budgetToolDefinitions(
  tools: ToolDefinition[],
  budgetTokens: number,
): ToolBudgetResult {
  if (budgetTokens <= 0) {
    return { tools, dropped: [], estimatedTokens: estimateToolsTokens(tools) };
  }

  const essential = tools.filter((t) => ESSENTIAL_TOOLS.has(t.name));
  const optional = tools.filter((t) => !ESSENTIAL_TOOLS.has(t.name));

  let spent = estimateToolsTokens(essential);
  const kept = new Set(essential.map((t) => t.name));
  const dropped: string[] = [];

  for (const tool of optional) {
    const cost = estimateToolTokens(tool);
    if (spent + cost <= budgetTokens) {
      spent += cost;
      kept.add(tool.name);
    } else {
      dropped.push(tool.name);
    }
  }

  return {
    // Filter the original array so the caller's ordering survives.
    tools: tools.filter((t) => kept.has(t.name)),
    dropped,
    estimatedTokens: spent,
  };
}

/** Token budget for tool schemas given the model's context window. */
export function toolBudgetForContext(contextLength: number): number {
  return Math.floor(contextLength * TOOL_BUDGET_FRACTION);
}
