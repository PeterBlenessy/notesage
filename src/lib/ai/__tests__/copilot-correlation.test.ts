import { describe, it, expect, beforeEach } from 'vitest';
import {
  openCopilotStream,
  closeCopilotStream,
  ownsCopilotProgress,
  ownsCopilotRequest,
  resetCopilotStreams,
} from '@/lib/ai/copilot-correlation';

describe('copilot-correlation', () => {
  beforeEach(() => {
    resetCopilotStreams();
  });

  describe('tokens', () => {
    it('gives every stream its own token in the shape the backend accepts', () => {
      const a = openCopilotStream();
      const b = openCopilotStream();
      expect(a.token).not.toBe(b.token);
      // `chat_work_done_token` in copilot_protocol.rs: prefix + [A-Za-z0-9_-], at most 128.
      for (const token of [a.token, b.token]) {
        expect(token).toMatch(/^copilot-chat-[A-Za-z0-9_-]+$/);
        expect(token.length).toBeLessThanOrEqual(128);
      }
    });
  });

  describe('progress events', () => {
    it('match on the token alone', () => {
      const a = openCopilotStream();
      const b = openCopilotStream();
      expect(ownsCopilotProgress(a, { token: a.token, conversationId: 'c1' })).toBe(true);
      expect(ownsCopilotProgress(b, { token: a.token, conversationId: 'c1' })).toBe(false);
    });

    it('are not ours without a token, even with a matching conversation id', () => {
      const a = openCopilotStream('c1');
      expect(ownsCopilotProgress(a, { conversationId: 'c1' })).toBe(false);
      expect(ownsCopilotProgress(a, { token: '', conversationId: 'c1' })).toBe(false);
      expect(ownsCopilotProgress(a, {})).toBe(false);
    });

    it("teach a new stream its conversation id from its own first event only", () => {
      const a = openCopilotStream();
      const b = openCopilotStream();
      ownsCopilotProgress(a, { token: b.token, conversationId: 'c-b' });
      expect(a.conversationId).toBeNull();
      ownsCopilotProgress(a, { token: a.token, conversationId: '' });
      expect(a.conversationId).toBeNull();
      ownsCopilotProgress(a, { token: a.token, conversationId: 'c-a' });
      expect(a.conversationId).toBe('c-a');
      // A later event cannot re-point it.
      ownsCopilotProgress(a, { token: a.token, conversationId: 'c-other' });
      expect(a.conversationId).toBe('c-a');
    });
  });

  describe('server requests', () => {
    it('go to the stream bound to the named conversation, and to no other', () => {
      const chat = openCopilotStream('c-chat');
      const task = openCopilotStream('c-task');
      expect(ownsCopilotRequest(chat, { conversationId: 'c-task' })).toBe(false);
      expect(ownsCopilotRequest(task, { conversationId: 'c-task' })).toBe(true);
    });

    it('with no conversation id are accepted by nobody while two streams are active', () => {
      const chat = openCopilotStream('c-chat');
      const task = openCopilotStream('c-task');
      for (const payload of [{ conversationId: '' }, {}, { conversationId: null }]) {
        expect(ownsCopilotRequest(chat, payload)).toBe(false);
        expect(ownsCopilotRequest(task, payload)).toBe(false);
      }
    });

    it('with no conversation id go to the only active stream', () => {
      const chat = openCopilotStream();
      expect(ownsCopilotRequest(chat, { conversationId: '' })).toBe(true);
      const task = openCopilotStream();
      expect(ownsCopilotRequest(chat, { conversationId: '' })).toBe(false);
      closeCopilotStream(task);
      expect(ownsCopilotRequest(chat, { conversationId: '' })).toBe(true);
    });

    it('let an unbound stream claim an id only when no other stream could own it', () => {
      const a = openCopilotStream();
      const b = openCopilotStream();
      // Both unknown: either could own c1, so neither guesses.
      expect(ownsCopilotRequest(a, { conversationId: 'c1' })).toBe(false);
      expect(ownsCopilotRequest(b, { conversationId: 'c1' })).toBe(false);
      expect(a.conversationId).toBeNull();

      // b learns it is c2 from its own progress; c1 can now only be a's.
      ownsCopilotProgress(b, { token: b.token, conversationId: 'c2' });
      expect(ownsCopilotRequest(b, { conversationId: 'c1' })).toBe(false);
      expect(ownsCopilotRequest(a, { conversationId: 'c1' })).toBe(true);
      expect(a.conversationId).toBe('c1');
    });

    it('never hand one event to two streams', () => {
      const streams = [openCopilotStream(), openCopilotStream('c1'), openCopilotStream()];
      for (const payload of [{ conversationId: 'c1' }, { conversationId: 'c9' }, { conversationId: '' }]) {
        const owners = streams.filter((s) => ownsCopilotRequest(s, payload));
        expect(owners.length).toBeLessThanOrEqual(1);
      }
    });

    it('are not accepted by a closed stream', () => {
      const a = openCopilotStream('c1');
      closeCopilotStream(a);
      expect(ownsCopilotRequest(a, { conversationId: 'c1' })).toBe(false);
      expect(ownsCopilotRequest(a, { conversationId: '' })).toBe(false);
    });
  });
});
