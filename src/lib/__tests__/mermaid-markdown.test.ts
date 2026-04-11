/**
 * Tests for the convertMermaidToHtml markdown preprocessor function.
 * Ensures mermaid fenced code blocks are correctly converted to HTML div elements
 * with properly escaped data attributes.
 */
import { describe, it, expect } from 'vitest';
import { convertMermaidToHtml } from '@/lib/markdown';

describe('convertMermaidToHtml', () => {
  it('converts a simple mermaid block to HTML div', () => {
    const input = '```mermaid\ngraph TD\n    A --> B\n```';
    const result = convertMermaidToHtml(input);
    expect(result).toContain('data-mermaid-source=');
    expect(result).toContain('data-type="mermaid"');
    expect(result).toContain('class="mermaid-block"');
  });

  it('does not affect non-mermaid code blocks', () => {
    const input = '```javascript\nconst x = 1;\n```';
    const result = convertMermaidToHtml(input);
    expect(result).toBe(input);
  });

  it('handles sequence diagram arrows (>>) without corruption', () => {
    const input = '```mermaid\nsequenceDiagram\n    Browser->>API: POST /login\n    API-->>Browser: 200 OK\n```';
    const result = convertMermaidToHtml(input);
    expect(result).toContain('data-mermaid-source=');
    // >> should be escaped to &gt;&gt;
    expect(result).toContain('&gt;&gt;');
    // Should not contain raw >> inside the attribute
    expect(result).not.toContain('>>');
  });

  it('handles blank lines inside mermaid blocks', () => {
    const input = '```mermaid\nsequenceDiagram\n    participant A\n\n    A->>B: hello\n```';
    const result = convertMermaidToHtml(input);
    expect(result).toContain('data-mermaid-source=');
    // Newlines should be encoded as &#10; to prevent HTML parser splitting
    expect(result).toContain('&#10;');
    // Should be a single div, not split
    const divCount = (result.match(/<div /g) || []).length;
    expect(divCount).toBe(1);
  });

  it('encodes newlines as &#10; in the attribute', () => {
    const input = '```mermaid\ngraph TD\n    A --> B\n```';
    const result = convertMermaidToHtml(input);
    // Every newline in the source should become &#10;
    expect(result).not.toMatch(/data-mermaid-source="[^"]*\n/);
  });

  it('escapes HTML special characters in source', () => {
    const input = '```mermaid\ngraph TD\n    A["<script>"] --> B["a & b"]\n```';
    const result = convertMermaidToHtml(input);
    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('a &amp; b');
    expect(result).not.toContain('<script>');
  });

  it('handles multiple mermaid blocks in one document', () => {
    const input = '# Title\n\n```mermaid\ngraph TD\n    A --> B\n```\n\nSome text\n\n```mermaid\npie\n    "A": 50\n    "B": 50\n```';
    const result = convertMermaidToHtml(input);
    const divCount = (result.match(/data-mermaid-source=/g) || []).length;
    expect(divCount).toBe(2);
    expect(result).toContain('# Title');
    expect(result).toContain('Some text');
  });

  it('preserves the mermaid source content round-trip through escape/unescape', () => {
    const source = 'sequenceDiagram\n    participant Browser\n    participant API\n    Browser->>API: GET /users\n    API-->>Browser: 200';
    const input = '```mermaid\n' + source + '\n```';
    const result = convertMermaidToHtml(input);

    // Extract the attribute value and decode it
    const match = result.match(/data-mermaid-source="([^"]*)"/);
    expect(match).not.toBeNull();
    const decoded = match![1]
      .replace(/&#10;/g, '\n')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    expect(decoded).toBe(source);
  });

  it('handles complex sequence diagram with alt/else blocks', () => {
    const source = [
      'sequenceDiagram',
      '    participant A',
      '    participant B',
      '    A->>B: request',
      '    alt success',
      '        B-->>A: 200',
      '    else failure',
      '        B-->>A: 500',
      '    end',
    ].join('\n');
    const input = '```mermaid\n' + source + '\n```';
    const result = convertMermaidToHtml(input);
    expect(result).toContain('data-mermaid-source=');
    // Verify no raw newlines in attribute
    const attrMatch = result.match(/data-mermaid-source="([^"]*)"/);
    expect(attrMatch).not.toBeNull();
    expect(attrMatch![1]).not.toContain('\n');
  });
});
