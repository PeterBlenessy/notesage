/**
 * Tests for the convertDrawingsToHtml markdown preprocessor function.
 * Pure function — no Tauri mocking needed.
 */
import { describe, it, expect } from 'vitest';
import { convertDrawingsToHtml, convertInlineDrawingsToHtml } from '@/lib/markdown';

describe('convertDrawingsToHtml', () => {
  it('converts excalidraw image to HTML div', () => {
    const input = '![drawing](/.notesage/drawings/abc123.excalidraw)';
    const result = convertDrawingsToHtml(input);
    expect(result).toContain('data-drawing-id="abc123"');
    expect(result).toContain('data-type="drawing"');
    expect(result).toContain('class="drawing-block"');
  });

  it('extracts drawing ID from nested path', () => {
    const input = '![drawing](/.notesage/drawings/my-drawing-id.excalidraw)';
    const result = convertDrawingsToHtml(input);
    expect(result).toContain('data-drawing-id="my-drawing-id"');
  });

  it('does not affect regular images', () => {
    const input = '![photo](images/photo.png)';
    const result = convertDrawingsToHtml(input);
    expect(result).toBe(input);
  });

  it('does not affect non-excalidraw image links', () => {
    const input = '![chart](data/chart.svg)';
    const result = convertDrawingsToHtml(input);
    expect(result).toBe(input);
  });

  it('handles multiple drawings in same document', () => {
    const input = [
      '![drawing](/.notesage/drawings/draw1.excalidraw)',
      '',
      'Some text',
      '',
      '![drawing](/.notesage/drawings/draw2.excalidraw)',
    ].join('\n');
    const result = convertDrawingsToHtml(input);
    expect(result).toContain('data-drawing-id="draw1"');
    expect(result).toContain('data-drawing-id="draw2"');
  });

  it('handles mixed images and drawings', () => {
    const input = [
      '![photo](vacation.jpg)',
      '',
      '![drawing](/.notesage/drawings/sketch.excalidraw)',
    ].join('\n');
    const result = convertDrawingsToHtml(input);
    expect(result).toContain('![photo](vacation.jpg)');
    expect(result).toContain('data-drawing-id="sketch"');
  });

  it('preserves surrounding content', () => {
    const input = [
      '# Title',
      '',
      '![drawing](/.notesage/drawings/abc.excalidraw)',
      '',
      'Paragraph after.',
    ].join('\n');
    const result = convertDrawingsToHtml(input);
    expect(result).toContain('# Title');
    expect(result).toContain('Paragraph after.');
    expect(result).toContain('data-drawing-id="abc"');
  });

  it('handles excalidraw file at arbitrary path depth', () => {
    const input = '![drawing](deep/nested/path/drawing.excalidraw)';
    const result = convertDrawingsToHtml(input);
    expect(result).toContain('data-drawing-id="drawing"');
  });

  it('handles drawing with empty alt text', () => {
    const input = '![](/.notesage/drawings/no-alt.excalidraw)';
    const result = convertDrawingsToHtml(input);
    expect(result).toContain('data-drawing-id="no-alt"');
  });

  it('does not match partial excalidraw extension', () => {
    // .excalidraw2 should not match
    const input = '![test](drawings/file.excalidraw2)';
    const result = convertDrawingsToHtml(input);
    expect(result).toBe(input);
  });

  it('outputs correct full HTML div', () => {
    const input = '![drawing](/.notesage/drawings/test-id.excalidraw)';
    const result = convertDrawingsToHtml(input);
    expect(result).toBe(
      '<div data-drawing-id="test-id" data-type="drawing" class="drawing-block"></div>',
    );
  });
});

describe('convertInlineDrawingsToHtml', () => {
  it('converts ```excalidraw block to HTML div with data-drawing-json', () => {
    const input = '```excalidraw\n{"type":"excalidraw","elements":[]}\n```';
    const result = convertInlineDrawingsToHtml(input);
    expect(result).toContain('data-drawing-json=');
    expect(result).toContain('data-type="drawing"');
    expect(result).toContain('class="drawing-block"');
  });

  it('regular code blocks not affected', () => {
    const jsonBlock = '```json\n{"key": "value"}\n```';
    const jsBlock = '```js\nconsole.log("hello");\n```';
    expect(convertInlineDrawingsToHtml(jsonBlock)).toBe(jsonBlock);
    expect(convertInlineDrawingsToHtml(jsBlock)).toBe(jsBlock);
  });

  it('multiple drawings work', () => {
    const input = [
      '```excalidraw',
      '{"elements":[1]}',
      '```',
      '',
      '```excalidraw',
      '{"elements":[2]}',
      '```',
    ].join('\n');
    const result = convertInlineDrawingsToHtml(input);
    const matches = result.match(/data-drawing-json=/g);
    expect(matches).toHaveLength(2);
  });

  it('JSON properly escaped', () => {
    const input = '```excalidraw\n{"label":"<b>A & B</b>"}\n```';
    const result = convertInlineDrawingsToHtml(input);
    expect(result).toContain('&lt;b&gt;A &amp; B&lt;/b&gt;');
    expect(result).not.toContain('<b>');
  });
});
