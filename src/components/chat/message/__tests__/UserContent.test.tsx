// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { UserContent } from '../UserContent';
import type { ChatMessage } from '@/lib/ai/types';

const userMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  role: 'user',
  content: 'What is the capital of France?',
  ...overrides,
});

describe('UserContent', () => {
  it('renders the message content for a plain user message', () => {
    render(<UserContent message={userMessage()} />);
    expect(screen.getByText('What is the capital of France?')).toBeTruthy();
  });

  it('prefers displayContent over content when present', () => {
    render(
      <UserContent
        message={userMessage({ content: 'raw injected body', displayContent: 'friendly display text' })}
      />,
    );
    expect(screen.getByText('friendly display text')).toBeTruthy();
    expect(screen.queryByText('raw injected body')).toBeNull();
  });

  it('shows a collapsed skill indicator with the skill name', () => {
    render(
      <UserContent
        message={userMessage({ skillName: 'summarize', content: 'skill body markdown', displayContent: 'user typed text' })}
      />,
    );
    expect(screen.getByText('Using skill: summarize')).toBeTruthy();
    // displayText is still shown alongside the skill affordance
    expect(screen.getByText('user typed text')).toBeTruthy();
    // Skill body stays hidden until expanded
    expect(screen.queryByText('skill body markdown')).toBeNull();
  });

  it('expands the skill body when the indicator is clicked', () => {
    render(
      <UserContent
        message={userMessage({ skillName: 'summarize', content: 'skill body markdown', displayContent: 'user typed text' })}
      />,
    );
    // Skill body hidden until expanded (only the display text is visible)
    expect(screen.queryByText('skill body markdown')).toBeNull();
    fireEvent.click(screen.getByText('Using skill: summarize'));
    expect(screen.getByText('skill body markdown')).toBeTruthy();
  });

  it('renders attachment thumbnails when the message has image attachments', () => {
    render(
      <UserContent
        message={userMessage({
          attachments: [
            { id: 'att-1', data: 'aGk=', mimeType: 'image/png', width: 10, height: 10, size: 100, name: 'pic.png' },
          ],
        })}
      />,
    );
    const img = screen.getByAltText('pic.png') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('data:image/png;base64,aGk=');
  });
});
