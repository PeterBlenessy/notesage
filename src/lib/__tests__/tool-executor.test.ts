// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { useSkillStore } from '@/stores/skill-store';
import { executeToolCall } from '@/lib/tool-executor';

describe('executeToolCall', () => {
  beforeEach(() => {
    // Reset skill store between tests
    useSkillStore.setState({ skills: [] });
  });

  // ---------------------------------------------------------------------------
  // read_file
  // ---------------------------------------------------------------------------

  describe('read_file', () => {
    it('returns file content on success', async () => {
      setMockInvokeHandler('read_file', () => '# Hello World');

      const result = await executeToolCall('call-1', 'read_file', {
        path: '/tmp/test.md',
      });

      expect(result).toEqual({
        tool_call_id: 'call-1',
        content: '# Hello World',
        is_error: false,
      });
    });

    it('returns error when path is missing', async () => {
      const result = await executeToolCall('call-2', 'read_file', {});

      expect(result).toEqual({
        tool_call_id: 'call-2',
        content: 'Missing required argument: path',
        is_error: true,
      });
    });

    it('returns error when invoke fails', async () => {
      setMockInvokeHandler('read_file', () => {
        throw new Error('File not found');
      });

      const result = await executeToolCall('call-3', 'read_file', {
        path: '/nonexistent',
      });

      expect(result).toEqual({
        tool_call_id: 'call-3',
        content: 'File not found',
        is_error: true,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // write_file
  // ---------------------------------------------------------------------------

  describe('write_file', () => {
    it('returns success message on write', async () => {
      setMockInvokeHandler('write_file', () => undefined);

      const result = await executeToolCall('call-4', 'write_file', {
        path: '/tmp/output.md',
        content: '# New content',
      });

      expect(result).toEqual({
        tool_call_id: 'call-4',
        content: 'File written successfully: /tmp/output.md',
        is_error: false,
      });
    });

    it('returns error when path is missing', async () => {
      const result = await executeToolCall('call-5', 'write_file', {
        content: 'some text',
      });

      expect(result).toEqual({
        tool_call_id: 'call-5',
        content: 'Missing required arguments: path, content',
        is_error: true,
      });
    });

    it('returns error when content is missing', async () => {
      const result = await executeToolCall('call-6', 'write_file', {
        path: '/tmp/file.md',
      });

      expect(result).toEqual({
        tool_call_id: 'call-6',
        content: 'Missing required arguments: path, content',
        is_error: true,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // read_skill_content
  // ---------------------------------------------------------------------------

  describe('read_skill_content', () => {
    it('resolves skill by name and returns formatted content', async () => {
      // Seed the skill store with a skill
      useSkillStore.setState({
        skills: [
          {
            name: 'test-skill',
            description: 'A test skill',
            path: '/home/user/.notesage/skills/test-skill',
            source: 'user',
            has_scripts: true,
            has_references: false,
          },
        ],
      });

      setMockInvokeHandler('read_skill_content', () => ({
        name: 'test-skill',
        body: 'This skill does things.',
        scripts: ['run.sh', 'build.py'],
        references: [],
        assets: [],
      }));

      const result = await executeToolCall('call-7', 'read_skill_content', {
        skill_name: 'test-skill',
      });

      expect(result.is_error).toBe(false);
      expect(result.tool_call_id).toBe('call-7');
      expect(result.content).toContain('# test-skill');
      expect(result.content).toContain('This skill does things.');
      expect(result.content).toContain('run.sh, build.py');
      expect(result.content).toContain('References: none');
    });

    it('returns error when skill_name is missing', async () => {
      const result = await executeToolCall('call-8', 'read_skill_content', {});

      expect(result).toEqual({
        tool_call_id: 'call-8',
        content: 'Missing required argument: skill_name',
        is_error: true,
      });
    });

    it('returns error when skill is not found', async () => {
      useSkillStore.setState({ skills: [] });

      const result = await executeToolCall('call-9', 'read_skill_content', {
        skill_name: 'nonexistent',
      });

      expect(result).toEqual({
        tool_call_id: 'call-9',
        content: 'Skill not found: nonexistent',
        is_error: true,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // execute_skill_script
  // ---------------------------------------------------------------------------

  describe('execute_skill_script', () => {
    it('executes script and returns stdout', async () => {
      useSkillStore.setState({
        skills: [
          {
            name: 'my-skill',
            description: 'desc',
            path: '/skills/my-skill',
            source: 'user',
            has_scripts: true,
            has_references: false,
          },
        ],
      });

      setMockInvokeHandler('execute_skill_script', () => ({
        stdout: 'Script output here',
        stderr: '',
        exit_code: 0,
        timed_out: false,
      }));

      const result = await executeToolCall('call-10', 'execute_skill_script', {
        skill_name: 'my-skill',
        script: 'run.sh',
        args: ['--flag'],
      });

      expect(result).toEqual({
        tool_call_id: 'call-10',
        content: 'Script output here',
        is_error: false,
      });
    });

    it('includes stderr and exit code when non-zero', async () => {
      useSkillStore.setState({
        skills: [
          {
            name: 'my-skill',
            description: 'desc',
            path: '/skills/my-skill',
            source: 'user',
            has_scripts: true,
            has_references: false,
          },
        ],
      });

      setMockInvokeHandler('execute_skill_script', () => ({
        stdout: 'partial output',
        stderr: 'something went wrong',
        exit_code: 1,
        timed_out: false,
      }));

      const result = await executeToolCall('call-11', 'execute_skill_script', {
        skill_name: 'my-skill',
        script: 'run.sh',
      });

      expect(result.is_error).toBe(false);
      expect(result.content).toContain('partial output');
      expect(result.content).toContain('STDERR: something went wrong');
      expect(result.content).toContain('Exit code: 1');
    });

    it('returns error when skill_name is missing', async () => {
      const result = await executeToolCall('call-12', 'execute_skill_script', {
        script: 'run.sh',
      });

      expect(result).toEqual({
        tool_call_id: 'call-12',
        content: 'Missing required arguments: skill_name, script',
        is_error: true,
      });
    });

    it('returns error when script is missing', async () => {
      const result = await executeToolCall('call-13', 'execute_skill_script', {
        skill_name: 'my-skill',
      });

      expect(result).toEqual({
        tool_call_id: 'call-13',
        content: 'Missing required arguments: skill_name, script',
        is_error: true,
      });
    });

    it('returns error when skill is not found', async () => {
      useSkillStore.setState({ skills: [] });

      const result = await executeToolCall('call-14', 'execute_skill_script', {
        skill_name: 'missing',
        script: 'run.sh',
      });

      expect(result).toEqual({
        tool_call_id: 'call-14',
        content: 'Skill not found: missing',
        is_error: true,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown tool
  // ---------------------------------------------------------------------------

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeToolCall('call-15', 'nonexistent_tool', {
        foo: 'bar',
      });

      expect(result).toEqual({
        tool_call_id: 'call-15',
        content: 'Unknown tool: nonexistent_tool',
        is_error: true,
      });
    });
  });
});
