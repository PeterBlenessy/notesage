import { describe, it, expect } from 'vitest';
import type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolCallStatus,
  ToolCallActivity,
  ChatMessage,
} from '../types';

describe('AI types', () => {
  describe('ToolDefinition', () => {
    it('should accept a valid tool definition', () => {
      const tool: ToolDefinition = {
        name: 'read_file',
        description: 'Reads a file from disk',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      };
      expect(tool.name).toBe('read_file');
      expect(tool.description).toBe('Reads a file from disk');
      expect(tool.input_schema).toHaveProperty('type', 'object');
    });
  });

  describe('ToolCall', () => {
    it('should accept a valid tool call', () => {
      const call: ToolCall = {
        id: 'tc_001',
        name: 'read_file',
        arguments: { path: '/tmp/test.md' },
      };
      expect(call.id).toBe('tc_001');
      expect(call.name).toBe('read_file');
      expect(call.arguments).toEqual({ path: '/tmp/test.md' });
    });

    it('should accept empty arguments', () => {
      const call: ToolCall = {
        id: 'tc_002',
        name: 'list_tools',
        arguments: {},
      };
      expect(call.arguments).toEqual({});
    });
  });

  describe('ToolResult', () => {
    it('should accept a successful tool result', () => {
      const result: ToolResult = {
        tool_call_id: 'tc_001',
        content: 'File contents here',
        is_error: false,
      };
      expect(result.is_error).toBe(false);
      expect(result.content).toBe('File contents here');
    });

    it('should accept an error tool result', () => {
      const result: ToolResult = {
        tool_call_id: 'tc_001',
        content: 'File not found',
        is_error: true,
      };
      expect(result.is_error).toBe(true);
    });
  });

  describe('ToolCallStatus', () => {
    it('should accept all valid status values', () => {
      const statuses: ToolCallStatus[] = ['pending', 'running', 'complete', 'error', 'denied'];
      expect(statuses).toHaveLength(5);
    });
  });

  describe('ToolCallActivity', () => {
    it('should accept a pending activity', () => {
      const activity: ToolCallActivity = {
        id: 'tc_001',
        name: 'read_file',
        arguments: { path: '/tmp/test.md' },
        status: 'pending',
        startedAt: Date.now(),
      };
      expect(activity.status).toBe('pending');
      expect(activity.result).toBeUndefined();
      expect(activity.error).toBeUndefined();
      expect(activity.completedAt).toBeUndefined();
    });

    it('should accept a completed activity with result', () => {
      const now = Date.now();
      const activity: ToolCallActivity = {
        id: 'tc_001',
        name: 'read_file',
        arguments: { path: '/tmp/test.md' },
        status: 'complete',
        result: 'File contents',
        startedAt: now - 1000,
        completedAt: now,
      };
      expect(activity.status).toBe('complete');
      expect(activity.result).toBe('File contents');
      expect(activity.completedAt).toBeGreaterThan(activity.startedAt);
    });

    it('should accept an error activity', () => {
      const activity: ToolCallActivity = {
        id: 'tc_001',
        name: 'read_file',
        arguments: { path: '/tmp/test.md' },
        status: 'error',
        error: 'Permission denied',
        startedAt: Date.now(),
        completedAt: Date.now(),
      };
      expect(activity.status).toBe('error');
      expect(activity.error).toBe('Permission denied');
    });

    it('should accept a denied activity', () => {
      const activity: ToolCallActivity = {
        id: 'tc_001',
        name: 'write_file',
        arguments: { path: '/etc/passwd' },
        status: 'denied',
        startedAt: Date.now(),
        completedAt: Date.now(),
      };
      expect(activity.status).toBe('denied');
    });
  });

  describe('ChatMessage', () => {
    it('should accept traditional roles', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      expect(messages).toHaveLength(3);
    });

    it('should accept the tool role', () => {
      const msg: ChatMessage = {
        role: 'tool',
        content: 'File contents here',
        toolCallId: 'tc_001',
      };
      expect(msg.role).toBe('tool');
      expect(msg.toolCallId).toBe('tc_001');
    });

    it('should accept an assistant message with tool calls', () => {
      const msg: ChatMessage = {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc_001', name: 'read_file', arguments: { path: '/tmp/test.md' } },
          { id: 'tc_002', name: 'list_dir', arguments: { path: '/tmp' } },
        ],
      };
      expect(msg.toolCalls).toHaveLength(2);
      expect(msg.toolCalls![0].name).toBe('read_file');
      expect(msg.toolCalls![1].name).toBe('list_dir');
    });

    it('should accept an assistant message with tool call activities', () => {
      const msg: ChatMessage = {
        role: 'assistant',
        content: 'Let me read that file.',
        toolCallActivities: [
          {
            id: 'tc_001',
            name: 'read_file',
            arguments: { path: '/tmp/test.md' },
            status: 'complete',
            result: 'Hello world',
            startedAt: 1000,
            completedAt: 2000,
          },
        ],
      };
      expect(msg.toolCallActivities).toHaveLength(1);
      expect(msg.toolCallActivities![0].status).toBe('complete');
    });

    it('should preserve existing optional fields alongside new ones', () => {
      const msg: ChatMessage = {
        role: 'assistant',
        content: 'Here is the file.',
        thinking: 'I should read the file first.',
        connectionId: 'conn-123',
        connectionLabel: 'Local AI',
        connectionProvider: 'local_bundled',
        toolCalls: [{ id: 'tc_001', name: 'read_file', arguments: {} }],
        toolCallActivities: [
          {
            id: 'tc_001',
            name: 'read_file',
            arguments: {},
            status: 'running',
            startedAt: Date.now(),
          },
        ],
      };
      expect(msg.thinking).toBe('I should read the file first.');
      expect(msg.connectionId).toBe('conn-123');
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCallActivities).toHaveLength(1);
    });
  });
});
