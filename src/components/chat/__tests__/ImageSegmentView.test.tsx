// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { ImageSegmentView } from '../segments/ImageSegmentView';
import type { ImageSegment } from '@/lib/ai/types';

const makeSegment = (overrides: Partial<ImageSegment> = {}): ImageSegment => ({
  type: 'image',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  mimeType: 'image/png',
  timestamp: Date.now(),
  ...overrides,
});

describe('ImageSegmentView', () => {
  it('renders an image with correct data URI', () => {
    const seg = makeSegment();
    render(<ImageSegmentView segment={seg} />);
    const img = screen.getByRole('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(`data:image/png;base64,${seg.data}`);
  });

  it('uses alt text from segment when provided', () => {
    render(<ImageSegmentView segment={makeSegment({ alt: 'Terminal screenshot' })} />);
    const img = screen.getByAltText('Terminal screenshot');
    expect(img).toBeTruthy();
  });

  it('uses default alt text when none provided', () => {
    render(<ImageSegmentView segment={makeSegment()} />);
    const img = screen.getByAltText('AI response image');
    expect(img).toBeTruthy();
  });

  it('opens full-size preview on click', () => {
    render(<ImageSegmentView segment={makeSegment()} />);
    const img = screen.getByRole('img');
    fireEvent.click(img);
    // Preview overlay should now be visible — there should be two images (inline + preview)
    const images = screen.getAllByRole('img');
    expect(images.length).toBe(2);
  });

  it('closes preview on Escape key', () => {
    render(<ImageSegmentView segment={makeSegment()} />);
    fireEvent.click(screen.getByRole('img'));
    expect(screen.getAllByRole('img').length).toBe(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getAllByRole('img').length).toBe(1);
  });

  it('the thumbnail is a keyboard-reachable button and the preview is a dialog', () => {
    render(<ImageSegmentView segment={makeSegment({ alt: 'Terminal screenshot' })} />);
    const trigger = screen.getByRole('button', { name: 'Terminal screenshot' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Terminal screenshot' });
    // Focus moves into the preview, and returns to the thumbnail on close.
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
