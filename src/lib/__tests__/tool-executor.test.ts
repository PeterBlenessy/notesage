// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { useSkillStore } from '@/stores/skill-store';
import { executeToolCall, mapArgsToStringArray } from '@/lib/tool-executor';
import type { ArgMapping } from '@/lib/tauri';

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

  // ---------------------------------------------------------------------------
  // Skill tool routing (skill__ prefix)
  // ---------------------------------------------------------------------------

  describe('skill tool routing', () => {
    beforeEach(() => {
      useSkillStore.setState({
        skills: [
          {
            name: 'download-webpage',
            description: 'Download a web page',
            path: '/skills/download-webpage',
            source: 'notesage-global',
            has_scripts: true,
            has_references: false,
          },
        ],
        skillTools: [
          {
            tool_name: 'skill__download_webpage',
            description: 'Download a web page',
            skill_name: 'download-webpage',
            script_path: 'scripts/download.mjs',
            parameters: {},
            arg_mapping: [
              { param_name: 'url', mapping_type: { type: 'Positional' }, position: 0 },
              { param_name: 'output_dir', mapping_type: { type: 'Positional' }, position: 1 },
              {
                param_name: 'force',
                mapping_type: { type: 'BoolFlag', value: { flag: '--force' } },
              },
            ],
            explicit_schema: false,
          },
        ],
      });
    });

    it('routes skill__ tool calls through execute_skill_script', async () => {
      let capturedArgs: Record<string, unknown> = {};
      setMockInvokeHandler('execute_skill_script', (_args) => {
        capturedArgs = _args as Record<string, unknown>;
        return { stdout: '{"status":"ok"}', stderr: '', exit_code: 0, timed_out: false };
      });

      const result = await executeToolCall('call-s1', 'skill__download_webpage', {
        url: 'https://example.com',
        output_dir: './articles',
        force: true,
      });

      expect(result.is_error).toBe(false);
      expect(result.content).toContain('{"status":"ok"}');
      expect(capturedArgs.skillPath).toBe('/skills/download-webpage');
      expect(capturedArgs.script).toBe('scripts/download.mjs');
      expect(capturedArgs.args).toEqual(['https://example.com', './articles', '--force']);
    });

    it('omits boolean flags when false', async () => {
      let capturedArgs: Record<string, unknown> = {};
      setMockInvokeHandler('execute_skill_script', (_args) => {
        capturedArgs = _args as Record<string, unknown>;
        return { stdout: 'ok', stderr: '', exit_code: 0, timed_out: false };
      });

      await executeToolCall('call-s2', 'skill__download_webpage', {
        url: 'https://example.com',
        output_dir: './out',
      });

      expect(capturedArgs.args).toEqual(['https://example.com', './out']);
    });

    it('returns error when skill tool not found', async () => {
      const result = await executeToolCall('call-s3', 'skill__nonexistent', { arg: 'val' });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Skill tool not found');
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

// ---------------------------------------------------------------------------
// mapArgsToStringArray — standalone unit tests
// ---------------------------------------------------------------------------

describe('mapArgsToStringArray', () => {
  it('maps positional args in order', () => {
    const mappings: ArgMapping[] = [
      { param_name: 'url', mapping_type: { type: 'Positional' }, position: 0 },
      { param_name: 'dir', mapping_type: { type: 'Positional' }, position: 1 },
    ];
    const result = mapArgsToStringArray(
      { url: 'https://example.com', dir: '/tmp' },
      mappings,
    );
    expect(result).toEqual(['https://example.com', '/tmp']);
  });

  it('maps boolean flags when true', () => {
    const mappings: ArgMapping[] = [
      { param_name: 'force', mapping_type: { type: 'BoolFlag', value: { flag: '--force' } } },
    ];
    expect(mapArgsToStringArray({ force: true }, mappings)).toEqual(['--force']);
  });

  it('omits boolean flags when false or undefined', () => {
    const mappings: ArgMapping[] = [
      { param_name: 'force', mapping_type: { type: 'BoolFlag', value: { flag: '--force' } } },
    ];
    expect(mapArgsToStringArray({ force: false }, mappings)).toEqual([]);
    expect(mapArgsToStringArray({}, mappings)).toEqual([]);
  });

  it('maps flag with value', () => {
    const mappings: ArgMapping[] = [
      { param_name: 'tag', mapping_type: { type: 'Flag', value: { flag: '--tag' } } },
    ];
    expect(mapArgsToStringArray({ tag: 'important' }, mappings)).toEqual([
      '--tag',
      'important',
    ]);
  });

  it('omits flag when value is undefined', () => {
    const mappings: ArgMapping[] = [
      { param_name: 'tag', mapping_type: { type: 'Flag', value: { flag: '--tag' } } },
    ];
    expect(mapArgsToStringArray({}, mappings)).toEqual([]);
  });

  it('spreads array values as multiple positional args', () => {
    const mappings: ArgMapping[] = [
      { param_name: 'query', mapping_type: { type: 'Positional' }, position: 0 },
      { param_name: 'dirs', mapping_type: { type: 'Spread' }, position: 1 },
    ];
    const result = mapArgsToStringArray(
      { query: 'test', dirs: ['/dir1', '/dir2', '/dir3'] },
      mappings,
    );
    expect(result).toEqual(['test', '/dir1', '/dir2', '/dir3']);
  });

  it('handles mixed positional, flags, and boolean flags', () => {
    const mappings: ArgMapping[] = [
      { param_name: 'content', mapping_type: { type: 'Positional' }, position: 0 },
      { param_name: 'output_dir', mapping_type: { type: 'Positional' }, position: 1 },
      { param_name: 'title', mapping_type: { type: 'Flag', value: { flag: '--title' } } },
      { param_name: 'tags', mapping_type: { type: 'Flag', value: { flag: '--tags' } } },
      { param_name: 'force', mapping_type: { type: 'BoolFlag', value: { flag: '--force' } } },
    ];
    const result = mapArgsToStringArray(
      {
        content: 'My article content',
        output_dir: './research',
        title: 'Article Title',
        tags: 'ai,research',
        force: true,
      },
      mappings,
    );
    expect(result).toEqual([
      'My article content',
      './research',
      '--title',
      'Article Title',
      '--tags',
      'ai,research',
      '--force',
    ]);
  });
});
