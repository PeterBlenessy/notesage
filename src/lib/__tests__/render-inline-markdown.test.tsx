// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderInlineMarkdown } from '../render-inline-markdown';

describe('renderInlineMarkdown', () => {
  it('renders **bold** as <strong>', () => {
    const { container } = render(<span>{renderInlineMarkdown('**bold text**')}</span>);
    expect(container.querySelector('strong')).not.toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('bold text');
  });

  it('renders `code` as <code>', () => {
    const { container } = render(<span>{renderInlineMarkdown('`myFunc()`')}</span>);
    expect(container.querySelector('code')).not.toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('myFunc()');
  });

  it('renders _italic_ as <em>', () => {
    const { container } = render(<span>{renderInlineMarkdown('_italic text_')}</span>);
    expect(container.querySelector('em')).not.toBeNull();
    expect(container.querySelector('em')?.textContent).toBe('italic text');
  });

  it('renders *italic* (single asterisk) as <em>', () => {
    const { container } = render(<span>{renderInlineMarkdown('*italic text*')}</span>);
    expect(container.querySelector('em')).not.toBeNull();
    expect(container.querySelector('em')?.textContent).toBe('italic text');
  });

  it('renders [text](url) as <a> with href', () => {
    const { container } = render(
      <span>{renderInlineMarkdown('[link text](https://example.com)')}</span>
    );
    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.textContent).toBe('link text');
    expect(anchor?.getAttribute('href')).toBe('https://example.com');
  });

  it('does not treat **bold** inside link text as nested italic', () => {
    const { container } = render(
      <span>{renderInlineMarkdown('**bold** and _italic_')}</span>
    );
    expect(container.querySelector('strong')).not.toBeNull();
    expect(container.querySelector('em')).not.toBeNull();
  });

  it('returns plain text when no markdown is found', () => {
    const { container } = render(<span>{renderInlineMarkdown('plain text')}</span>);
    expect(container.textContent).toBe('plain text');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
    expect(container.querySelector('code')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });
});
