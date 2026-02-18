import { describe, it, expect } from 'vitest';
import {
  matchBlocksToLines,
  isNonContentLine,
  getPositionRangeForLines,
  type BlockEntry,
  type LineMapping,
} from '../pm-line-map';

// Helper to create a BlockEntry for tests
function block(type: string, pmFrom: number, pmTo: number, textContent = ''): BlockEntry {
  return { type, pmFrom, pmTo, textContent };
}

describe('isNonContentLine', () => {
  it('returns true for empty lines', () => {
    expect(isNonContentLine('')).toBe(true);
    expect(isNonContentLine('  ')).toBe(true);
    expect(isNonContentLine('\t')).toBe(true);
  });

  it('returns true for empty blockquote continuation lines', () => {
    expect(isNonContentLine('>')).toBe(true);
    expect(isNonContentLine('> ')).toBe(true);
    expect(isNonContentLine('>  ')).toBe(true);
    expect(isNonContentLine('> > ')).toBe(true);
    expect(isNonContentLine('>>')).toBe(true);
  });

  it('returns true for table separator lines', () => {
    expect(isNonContentLine('| --- | --- |')).toBe(true);
    expect(isNonContentLine('|---|---|')).toBe(true);
    expect(isNonContentLine('| :--- | ---: |')).toBe(true);
    expect(isNonContentLine('| :---: | :---: |')).toBe(true);
    expect(isNonContentLine('|:---:|:---:|')).toBe(true);
    expect(isNonContentLine('| ---- | ---- |')).toBe(true);
  });

  it('returns false for content lines', () => {
    expect(isNonContentLine('Hello')).toBe(false);
    expect(isNonContentLine('# Heading')).toBe(false);
    expect(isNonContentLine('- list item')).toBe(false);
    expect(isNonContentLine('> Some text')).toBe(false);
    expect(isNonContentLine('```python')).toBe(false);
    expect(isNonContentLine('---')).toBe(false); // horizontal rule, not table separator
    expect(isNonContentLine('| Cell 1 | Cell 2 |')).toBe(false);
  });
});

describe('matchBlocksToLines', () => {
  it('maps a simple paragraph', () => {
    const blocks = [block('paragraph', 0, 12, 'Hello world')];
    const lines = ['Hello world'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(1);
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 12 });
  });

  it('maps multiple paragraphs separated by blank lines', () => {
    const blocks = [
      block('paragraph', 0, 10, 'First'),
      block('paragraph', 10, 22, 'Second'),
      block('paragraph', 22, 32, 'Third'),
    ];
    const lines = ['First', '', 'Second', '', 'Third'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(3);
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 10 });
    expect(map.get(3)).toEqual({ pmFrom: 10, pmTo: 22 });
    expect(map.get(5)).toEqual({ pmFrom: 22, pmTo: 32 });
    // Empty lines should not be mapped
    expect(map.has(2)).toBe(false);
    expect(map.has(4)).toBe(false);
  });

  it('maps headings', () => {
    const blocks = [
      block('heading', 0, 8, 'Title'),
      block('paragraph', 8, 20, 'Some text'),
    ];
    const lines = ['# Title', '', 'Some text'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 8 });
    expect(map.get(3)).toEqual({ pmFrom: 8, pmTo: 20 });
  });

  it('maps headings of different levels', () => {
    const blocks = [
      block('heading', 0, 10, 'H1'),
      block('heading', 10, 20, 'H2'),
      block('heading', 20, 30, 'H3'),
    ];
    const lines = ['# H1', '', '## H2', '', '### H3'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(3);
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 10 });
    expect(map.get(3)).toEqual({ pmFrom: 10, pmTo: 20 });
    expect(map.get(5)).toEqual({ pmFrom: 20, pmTo: 30 });
  });

  it('maps bullet list items', () => {
    const blocks = [
      block('listItem', 0, 12, 'Item one'),
      block('listItem', 12, 25, 'Item two'),
      block('listItem', 25, 40, 'Item three'),
    ];
    const lines = ['- Item one', '- Item two', '- Item three'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(3);
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 12 });
    expect(map.get(2)).toEqual({ pmFrom: 12, pmTo: 25 });
    expect(map.get(3)).toEqual({ pmFrom: 25, pmTo: 40 });
  });

  it('maps ordered list items', () => {
    const blocks = [
      block('listItem', 0, 10, 'First'),
      block('listItem', 10, 22, 'Second'),
    ];
    const lines = ['1. First', '2. Second'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(2);
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 10 });
    expect(map.get(2)).toEqual({ pmFrom: 10, pmTo: 22 });
  });

  it('maps task list items', () => {
    const blocks = [
      block('taskItem', 0, 14, 'Done item'),
      block('taskItem', 14, 28, 'Todo item'),
    ];
    const lines = ['- [x] Done item', '- [ ] Todo item'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(2);
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 14 });
    expect(map.get(2)).toEqual({ pmFrom: 14, pmTo: 28 });
  });

  it('maps code block (all lines → same PM node)', () => {
    const blocks = [
      block('codeBlock', 0, 30, 'def hello():\n    pass'),
    ];
    const lines = ['```python', 'def hello():', '    pass', '```'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(4);
    // All four lines map to the same code block node
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 30 });
    expect(map.get(2)).toEqual({ pmFrom: 0, pmTo: 30 });
    expect(map.get(3)).toEqual({ pmFrom: 0, pmTo: 30 });
    expect(map.get(4)).toEqual({ pmFrom: 0, pmTo: 30 });
  });

  it('maps empty code block', () => {
    const blocks = [block('codeBlock', 0, 10, '')];
    const lines = ['```', '```'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(2);
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 10 });
    expect(map.get(2)).toEqual({ pmFrom: 0, pmTo: 10 });
  });

  it('maps code block with blank lines in content', () => {
    const blocks = [
      block('codeBlock', 0, 40, 'line 1\n\nline 3'),
    ];
    // The blank line inside the code block is part of the content
    const lines = ['```', 'line 1', '', 'line 3', '```'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(5);
    // Opening fence
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 40 });
    // Content lines (including blank line inside code block)
    expect(map.get(2)).toEqual({ pmFrom: 0, pmTo: 40 });
    expect(map.get(3)).toEqual({ pmFrom: 0, pmTo: 40 });
    expect(map.get(4)).toEqual({ pmFrom: 0, pmTo: 40 });
    // Closing fence
    expect(map.get(5)).toEqual({ pmFrom: 0, pmTo: 40 });
  });

  it('maps horizontal rule', () => {
    const blocks = [
      block('paragraph', 0, 10, 'Above'),
      block('horizontalRule', 10, 12, ''),
      block('paragraph', 12, 22, 'Below'),
    ];
    const lines = ['Above', '', '---', '', 'Below'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 10 });
    expect(map.get(3)).toEqual({ pmFrom: 10, pmTo: 12 });
    expect(map.get(5)).toEqual({ pmFrom: 12, pmTo: 22 });
  });

  it('maps blockquote with single paragraph', () => {
    // Blockquote in PM: the paragraph inside the blockquote is captured
    const blocks = [
      block('paragraph', 2, 18, 'Quoted text'),
    ];
    const lines = ['> Quoted text'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(1);
    expect(map.get(1)).toEqual({ pmFrom: 2, pmTo: 18 });
  });

  it('maps blockquote with multiple paragraphs', () => {
    const blocks = [
      block('paragraph', 2, 20, 'First paragraph'),
      block('paragraph', 20, 42, 'Second paragraph'),
    ];
    const lines = ['> First paragraph', '>', '> Second paragraph'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(2);
    expect(map.get(1)).toEqual({ pmFrom: 2, pmTo: 20 });
    // Line 2 is ">" (empty blockquote continuation), skipped
    expect(map.has(2)).toBe(false);
    expect(map.get(3)).toEqual({ pmFrom: 20, pmTo: 42 });
  });

  it('maps table rows (skips separator line)', () => {
    const blocks = [
      block('tableRow', 2, 20, 'NameAge'),
      block('tableRow', 20, 38, 'Alice30'),
      block('tableRow', 38, 54, 'Bob25'),
    ];
    const lines = [
      '| Name  | Age |',
      '| ----- | --- |',
      '| Alice | 30  |',
      '| Bob   | 25  |',
    ];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(3);
    expect(map.get(1)).toEqual({ pmFrom: 2, pmTo: 20 }); // header row
    expect(map.has(2)).toBe(false); // separator skipped
    expect(map.get(3)).toEqual({ pmFrom: 20, pmTo: 38 }); // data row 1
    expect(map.get(4)).toEqual({ pmFrom: 38, pmTo: 54 }); // data row 2
  });

  it('maps image', () => {
    const blocks = [
      block('paragraph', 0, 12, 'Some text'),
      block('image', 12, 14, ''),
    ];
    const lines = ['Some text', '', '![Alt](https://example.com/img.png)'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 12 });
    expect(map.get(3)).toEqual({ pmFrom: 12, pmTo: 14 });
  });

  it('maps a representative document with all block types', () => {
    const blocks = [
      block('heading', 0, 12, 'My Document'),          // # My Document
      block('paragraph', 12, 30, 'Introduction text'),  // Introduction text
      block('listItem', 32, 44, 'Item one'),            // - Item one
      block('listItem', 44, 57, 'Item two'),            // - Item two
      block('listItem', 57, 72, 'Item three'),          // - Item three
      block('paragraph', 74, 90, 'Middle section'),     // Middle section
      block('codeBlock', 90, 130, 'const x = 1;\nreturn x;'), // code block
      block('horizontalRule', 130, 132, ''),            // ---
      block('paragraph', 134, 152, 'Quoted text'),      // > Quoted text (inside blockquote)
      block('tableRow', 154, 170, 'ColAColB'),          // | ColA | ColB |
      block('tableRow', 170, 186, 'Val1Val2'),          // | Val1 | Val2 |
      block('paragraph', 188, 200, 'The end'),          // The end
    ];
    const lines = [
      '# My Document',       // 1
      '',                     // 2
      'Introduction text',   // 3
      '',                     // 4
      '- Item one',          // 5
      '- Item two',          // 6
      '- Item three',        // 7
      '',                     // 8
      'Middle section',      // 9
      '',                     // 10
      '```javascript',       // 11
      'const x = 1;',        // 12
      'return x;',           // 13
      '```',                 // 14
      '',                     // 15
      '---',                 // 16
      '',                     // 17
      '> Quoted text',       // 18
      '',                     // 19
      '| ColA | ColB |',     // 20
      '| ---- | ---- |',     // 21
      '| Val1 | Val2 |',     // 22
      '',                     // 23
      'The end',             // 24
    ];
    const map = matchBlocksToLines(blocks, lines);

    // Heading
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 12 });
    // Paragraph
    expect(map.get(3)).toEqual({ pmFrom: 12, pmTo: 30 });
    // List items
    expect(map.get(5)).toEqual({ pmFrom: 32, pmTo: 44 });
    expect(map.get(6)).toEqual({ pmFrom: 44, pmTo: 57 });
    expect(map.get(7)).toEqual({ pmFrom: 57, pmTo: 72 });
    // Middle paragraph
    expect(map.get(9)).toEqual({ pmFrom: 74, pmTo: 90 });
    // Code block (all lines map to same node)
    expect(map.get(11)).toEqual({ pmFrom: 90, pmTo: 130 });
    expect(map.get(12)).toEqual({ pmFrom: 90, pmTo: 130 });
    expect(map.get(13)).toEqual({ pmFrom: 90, pmTo: 130 });
    expect(map.get(14)).toEqual({ pmFrom: 90, pmTo: 130 });
    // Horizontal rule
    expect(map.get(16)).toEqual({ pmFrom: 130, pmTo: 132 });
    // Blockquote paragraph
    expect(map.get(18)).toEqual({ pmFrom: 134, pmTo: 152 });
    // Table (header + data, separator skipped)
    expect(map.get(20)).toEqual({ pmFrom: 154, pmTo: 170 });
    expect(map.has(21)).toBe(false); // separator
    expect(map.get(22)).toEqual({ pmFrom: 170, pmTo: 186 });
    // Final paragraph
    expect(map.get(24)).toEqual({ pmFrom: 188, pmTo: 200 });

    // Empty lines should not be mapped
    expect(map.has(2)).toBe(false);
    expect(map.has(4)).toBe(false);
    expect(map.has(8)).toBe(false);
    expect(map.has(10)).toBe(false);
    expect(map.has(15)).toBe(false);
    expect(map.has(17)).toBe(false);
    expect(map.has(19)).toBe(false);
    expect(map.has(23)).toBe(false);
  });

  it('handles empty document', () => {
    const blocks: BlockEntry[] = [];
    const lines: string[] = [];
    const map = matchBlocksToLines(blocks, lines);
    expect(map.size).toBe(0);
  });

  it('handles more lines than blocks (trailing content)', () => {
    const blocks = [block('paragraph', 0, 10, 'Hello')];
    const lines = ['Hello', '', 'Extra line that has no block'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(1);
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 10 });
  });

  it('handles more blocks than lines (truncated markdown)', () => {
    const blocks = [
      block('paragraph', 0, 10, 'First'),
      block('paragraph', 10, 22, 'Second'),
    ];
    const lines = ['First'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.size).toBe(1);
    expect(map.get(1)).toEqual({ pmFrom: 0, pmTo: 10 });
  });

  it('maps list followed by paragraph', () => {
    const blocks = [
      block('listItem', 2, 14, 'Item A'),
      block('listItem', 14, 26, 'Item B'),
      block('paragraph', 28, 40, 'After list'),
    ];
    const lines = ['- Item A', '- Item B', '', 'After list'];
    const map = matchBlocksToLines(blocks, lines);

    expect(map.get(1)).toEqual({ pmFrom: 2, pmTo: 14 });
    expect(map.get(2)).toEqual({ pmFrom: 14, pmTo: 26 });
    expect(map.get(4)).toEqual({ pmFrom: 28, pmTo: 40 });
  });
});

describe('getPositionRangeForLines', () => {
  const lineMap = new Map<number, LineMapping>([
    [1, { pmFrom: 0, pmTo: 12 }],
    [3, { pmFrom: 12, pmTo: 30 }],
    [5, { pmFrom: 32, pmTo: 44 }],
    [6, { pmFrom: 44, pmTo: 57 }],
    [7, { pmFrom: 57, pmTo: 72 }],
  ]);

  it('returns single line mapping', () => {
    const range = getPositionRangeForLines(lineMap, 1, 1);
    expect(range).toEqual({ pmFrom: 0, pmTo: 12 });
  });

  it('returns union of multiple line mappings', () => {
    const range = getPositionRangeForLines(lineMap, 5, 7);
    expect(range).toEqual({ pmFrom: 32, pmTo: 72 });
  });

  it('skips unmapped lines in range', () => {
    // Lines 3-6: line 4 is unmapped (empty line), but 3, 5, 6 are mapped
    const range = getPositionRangeForLines(lineMap, 3, 6);
    expect(range).toEqual({ pmFrom: 12, pmTo: 57 });
  });

  it('returns null when no lines in range are mapped', () => {
    const range = getPositionRangeForLines(lineMap, 2, 2);
    expect(range).toBeNull();
  });

  it('returns null for empty range', () => {
    const range = getPositionRangeForLines(lineMap, 100, 200);
    expect(range).toBeNull();
  });
});
