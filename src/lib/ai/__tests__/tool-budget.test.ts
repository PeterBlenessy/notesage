import { describe, expect, it } from 'vitest';
import {
  budgetToolDefinitions,
  estimateToolTokens,
  estimateToolsTokens,
  toolBudgetForContext,
  TOOL_BUDGET_FRACTION,
} from '../tool-budget';
import type { ToolDefinition } from '../types';

function tool(name: string, schemaPadding = 0): ToolDefinition {
  return {
    name,
    description: `Does ${name}`,
    input_schema: {
      type: 'object',
      properties: { arg: { type: 'string', description: 'x'.repeat(schemaPadding) } },
    },
  };
}

describe('estimateToolTokens', () => {
  it('counts the schema, not just the name — schemas are the bulk of the cost', () => {
    const small = estimateToolTokens(tool('a'));
    const large = estimateToolTokens(tool('a', 4000));
    expect(large).toBeGreaterThan(small * 10);
  });
});

describe('budgetToolDefinitions', () => {
  it('keeps everything when it fits', () => {
    const tools = [tool('read_file'), tool('custom_one'), tool('custom_two')];
    const result = budgetToolDefinitions(tools, 100_000);
    expect(result.tools).toHaveLength(3);
    expect(result.dropped).toEqual([]);
  });

  it('drops optional tools that do not fit, and names every one', () => {
    // A silent cap is the failure mode this exists to prevent: a truncated
    // tool list looks identical to a model that chose not to use them.
    const tools = [tool('read_file'), tool('fat_skill', 8000), tool('other_skill', 8000)];
    const result = budgetToolDefinitions(tools, estimateToolTokens(tools[0]) + 10);

    expect(result.tools.map((t) => t.name)).toEqual(['read_file']);
    expect(result.dropped).toEqual(['fat_skill', 'other_skill']);
  });

  it('never drops an essential tool, however tight the budget', () => {
    // An agent without read_file is not a cheaper agent, it is a broken one.
    const tools = [tool('some_skill', 500), tool('read_file'), tool('list_directory')];
    const result = budgetToolDefinitions(tools, 1);

    expect(result.tools.map((t) => t.name)).toEqual(['read_file', 'list_directory']);
    expect(result.dropped).toEqual(['some_skill']);
  });

  it('preserves the caller-supplied order of whatever survives', () => {
    const tools = [tool('aaa'), tool('read_file'), tool('bbb')];
    const result = budgetToolDefinitions(tools, 100_000);
    expect(result.tools.map((t) => t.name)).toEqual(['aaa', 'read_file', 'bbb']);
  });

  it('treats a non-positive budget as "no information", not "drop everything"', () => {
    // A caller without context info must get an unmodified list rather than an
    // agent stripped of its tools.
    const tools = [tool('a'), tool('b')];
    for (const budget of [0, -1]) {
      const result = budgetToolDefinitions(tools, budget);
      expect(result.tools).toHaveLength(2);
      expect(result.dropped).toEqual([]);
    }
  });

  it('reports what the kept set actually costs', () => {
    const tools = [tool('read_file'), tool('skill', 6000)];
    const result = budgetToolDefinitions(tools, estimateToolTokens(tools[0]) + 5);
    expect(result.estimatedTokens).toBe(estimateToolsTokens(result.tools));
  });

  it('handles an empty list without inventing work', () => {
    const result = budgetToolDefinitions([], 1000);
    expect(result.tools).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.estimatedTokens).toBe(0);
  });
});

describe('toolBudgetForContext', () => {
  it('reserves the overwhelming majority of the window for actual work', () => {
    // Tool overhead is paid every turn; whatever it takes is unavailable to the
    // conversation, the files read, and the model's own output.
    expect(toolBudgetForContext(32768)).toBe(Math.floor(32768 * TOOL_BUDGET_FRACTION));
    expect(toolBudgetForContext(32768)).toBeLessThan(32768 * 0.2);
  });

  it('scales with the window', () => {
    expect(toolBudgetForContext(65536)).toBe(toolBudgetForContext(32768) * 2);
  });
});
