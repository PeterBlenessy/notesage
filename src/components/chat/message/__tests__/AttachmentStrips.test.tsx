// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/component-harness';
import { AttachmentFileStrip, AttachmentThumbnails } from '../AttachmentStrips';
import type { ChatMessage } from '@/lib/ai/types';

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  role: 'user',
  content: 'hi',
  ...overrides,
});

describe('AttachmentFileStrip', () => {
  it('renders nothing when there are no attachment activities', () => {
    const { container } = render(<AttachmentFileStrip message={message()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a chip per file-path attachment using the basename label', () => {
    render(
      <AttachmentFileStrip
        message={message({
          activities: [
            { kind: 'attachment', label: 'notes.md', detail: '/home/user/notes.md', status: 'done', timestamp: 1 },
            { kind: 'attachment', label: 'todo.md', detail: '/home/user/todo.md', status: 'done', timestamp: 2 },
          ],
        })}
      />,
    );
    expect(screen.getByText('notes.md')).toBeTruthy();
    expect(screen.getByText('todo.md')).toBeTruthy();
  });

  it('ignores non-attachment activities', () => {
    const { container } = render(
      <AttachmentFileStrip
        message={message({
          activities: [{ kind: 'tool_call', label: 'ran tool', status: 'done', timestamp: 1 }],
        })}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('AttachmentThumbnails', () => {
  it('renders nothing when there are no image attachments', () => {
    const { container } = render(<AttachmentThumbnails message={message()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an image thumbnail per attachment with a data URL src', () => {
    render(
      <AttachmentThumbnails
        message={message({
          attachments: [
            { id: 'a1', data: 'Zm9v', mimeType: 'image/jpeg', width: 10, height: 10, size: 100, name: 'photo.jpg' },
          ],
        })}
      />,
    );
    const img = screen.getByAltText('photo.jpg') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('data:image/jpeg;base64,Zm9v');
  });

  it('falls back to a generic alt label when the attachment has no name', () => {
    render(
      <AttachmentThumbnails
        message={message({
          attachments: [
            { id: 'a1', data: 'Zm9v', mimeType: 'image/png', width: 10, height: 10, size: 100 },
          ],
        })}
      />,
    );
    expect(screen.getByAltText('Attached image')).toBeTruthy();
  });
});
