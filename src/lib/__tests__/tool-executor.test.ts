// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { useSkillStore } from '@/stores/skill-store';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useCommentStore } from '@/stores/comment-store';
import { executeToolCall, mapArgsToStringArray, isSkillScriptTool, resolveSkillScriptTarget } from '@/lib/tool-executor';
import type { ArgMapping } from '@/lib/tauri';

vi.mock('@/lib/editor-bridge', () => ({
  getEditorRef: () => ({ state: { doc: null } }),
  setEditorRef: vi.fn(),
}));

vi.mock('@/lib/pm-text-search', () => ({
  findTextInDoc: () => null,
}));

vi.mock('@/components/editor/extensions/comment-mark', () => ({
  setCommentDecorations: vi.fn(),
  CommentMarkPluginKey: { getState: () => null },
}));

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

      const result = await executeToolCall(
        'call-3',
        'read_file',
        { path: '/tmp/nonexistent' },
        { projectRoots: ['/tmp'], homeDir: '/Users/tester' },
      );

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
  // Skill-script approvals are pinned to content (audit 2026-11-22 §6): the
  // chat resolves which script a call runs, hashes it, and hands the hash back
  // so the backend refuses a body that changed after the approval check.
  // ---------------------------------------------------------------------------

  describe('skill-script target resolution and hash pinning', () => {
    const skill = {
      name: 'my-skill',
      description: 'desc',
      path: '/skills/my-skill',
      source: 'user',
      has_scripts: true,
      has_references: false,
    };
    const skillTool = {
      tool_name: 'skill__my-skill__convert',
      description: 'Convert',
      skill_name: 'my-skill',
      script_path: 'scripts/convert.py',
      parameters: {},
      arg_mapping: [],
      explicit_schema: true,
    };
    let executeArgs: Record<string, unknown> | undefined;

    beforeEach(() => {
      executeArgs = undefined;
      useSkillStore.setState({ skills: [skill], skillTools: [skillTool], enabledOverrides: {} });
      setMockInvokeHandler('execute_skill_script', (args) => {
        executeArgs = args as Record<string, unknown>;
        return { stdout: 'ok', stderr: '', exit_code: 0, timed_out: false };
      });
    });

    it('recognises both skill-script tool shapes and nothing else', () => {
      expect(isSkillScriptTool('execute_skill_script')).toBe(true);
      expect(isSkillScriptTool('skill__my-skill__convert')).toBe(true);
      expect(isSkillScriptTool('write_file')).toBe(false);
      expect(isSkillScriptTool('read_skill_content')).toBe(false);
    });

    it('resolves the generic tool to the named skill and script', () => {
      expect(
        resolveSkillScriptTarget('execute_skill_script', { skill_name: 'my-skill', script: 'run.sh' }),
      ).toEqual({ skillName: 'my-skill', skillPath: '/skills/my-skill', script: 'run.sh' });
    });

    it('resolves a generated skill tool to its script', () => {
      expect(resolveSkillScriptTarget('skill__my-skill__convert', { input: 'a.md' })).toEqual({
        skillName: 'my-skill',
        skillPath: '/skills/my-skill',
        script: 'scripts/convert.py',
      });
    });

    it('resolves nothing for unknown skills, malformed arguments or other tools', () => {
      expect(resolveSkillScriptTarget('execute_skill_script', { skill_name: 'nope', script: 'run.sh' })).toBeNull();
      expect(resolveSkillScriptTarget('execute_skill_script', { skill_name: 'my-skill' })).toBeNull();
      expect(resolveSkillScriptTarget('execute_skill_script', { skill_name: { a: 1 }, script: 'run.sh' })).toBeNull();
      expect(resolveSkillScriptTarget('skill__unknown__tool', {})).toBeNull();
      expect(resolveSkillScriptTarget('write_file', { path: '/tmp/x' })).toBeNull();
    });

    it('forwards the approved hash to the backend for the generic tool', async () => {
      await executeToolCall(
        'call-h1',
        'execute_skill_script',
        { skill_name: 'my-skill', script: 'run.sh' },
        undefined,
        { expectedSkillScriptHash: 'abc123' },
      );
      expect(executeArgs).toMatchObject({ skillPath: '/skills/my-skill', script: 'run.sh', expectedHash: 'abc123' });
    });

    it('forwards the approved hash to the backend for a generated skill tool', async () => {
      await executeToolCall('call-h2', 'skill__my-skill__convert', { args: ['a.md'] }, undefined, {
        expectedSkillScriptHash: 'def456',
      });
      expect(executeArgs).toMatchObject({ script: 'scripts/convert.py', expectedHash: 'def456' });
    });

    it('sends no expectedHash when the caller has none', async () => {
      await executeToolCall('call-h3', 'execute_skill_script', { skill_name: 'my-skill', script: 'run.sh' });
      expect(executeArgs).toBeDefined();
      expect(executeArgs).not.toHaveProperty('expectedHash');
    });
  });

  // ---------------------------------------------------------------------------
  // list_directory
  // ---------------------------------------------------------------------------

  describe('list_directory', () => {
    it('passes showHidden: true to always show hidden files for AI', async () => {
      let capturedArgs: Record<string, unknown> = {};
      setMockInvokeHandler('list_files_shallow', (_args) => {
        capturedArgs = _args as Record<string, unknown>;
        return [
          { name: 'readme.md', path: '/tmp/readme.md', is_directory: false, hidden: false },
          { name: '.gitignore', path: '/tmp/.gitignore', is_directory: false, hidden: true },
        ];
      });

      const result = await executeToolCall('call-ld1', 'list_directory', {
        path: '/tmp',
      });

      expect(result.is_error).toBe(false);
      expect(capturedArgs.showHidden).toBe(true);
      expect(result.content).toContain('readme.md');
      expect(result.content).toContain('.gitignore');
    });

    it('returns error when path is missing', async () => {
      const result = await executeToolCall('call-ld2', 'list_directory', {});

      expect(result).toEqual({
        tool_call_id: 'call-ld2',
        content: 'Missing required argument: path',
        is_error: true,
      });
    });
  });

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

  // ---------------------------------------------------------------------------
  // Scope enforcement — leak #8 red-team invariants
  //
  // A direct-API chat scoped to Project A must NOT be able to read, list, or
  // write files in Project B or anywhere else outside the configured
  // projectRoots. Missing scope defaults to DENY — the secure default.
  // ---------------------------------------------------------------------------

  describe('scope enforcement (leak #8)', () => {
    const homeDir = '/Users/tester';
    const projectA = '/Users/tester/Projects/project-a';
    const projectB = '/Users/tester/Projects/project-b';

    it('denies read_file outside scope when scope = projectA', async () => {
      let readCalled = false;
      setMockInvokeHandler('read_file', () => {
        readCalled = true;
        return '# project-b secret';
      });

      const result = await executeToolCall(
        'attack-1',
        'read_file',
        { path: `${projectB}/secrets.md` },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Denied: path outside project scope');
      expect(readCalled).toBe(false);
    });

    it('allows read_file inside scope', async () => {
      setMockInvokeHandler('read_file', () => '# in-scope content');

      const result = await executeToolCall(
        'ok-1',
        'read_file',
        { path: `${projectA}/notes.md` },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(false);
      expect(result.content).toBe('# in-scope content');
    });

    it('allows read_file inside any of multiple scope roots', async () => {
      setMockInvokeHandler('read_file', () => '# content');

      const result = await executeToolCall(
        'ok-2',
        'read_file',
        { path: `${projectB}/doc.md` },
        { projectRoots: [projectA, projectB], homeDir },
      );

      expect(result.is_error).toBe(false);
    });

    it('denies list_directory outside scope', async () => {
      let listCalled = false;
      setMockInvokeHandler('list_files_shallow', () => {
        listCalled = true;
        return [];
      });

      const result = await executeToolCall(
        'attack-2',
        'list_directory',
        { path: `${projectB}/src` },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Denied: path outside project scope');
      expect(listCalled).toBe(false);
    });

    it('denies write_file outside scope', async () => {
      let writeCalled = false;
      setMockInvokeHandler('write_file', () => {
        writeCalled = true;
        return undefined;
      });

      const result = await executeToolCall(
        'attack-3',
        'write_file',
        { path: `${projectB}/evil.md`, content: 'exfiltrated' },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Denied: path outside project scope');
      expect(writeCalled).toBe(false);
    });

    it('missing scope denies filesystem tools (secure default)', async () => {
      let readCalled = false;
      setMockInvokeHandler('read_file', () => {
        readCalled = true;
        return '# leaked';
      });

      const result = await executeToolCall('default-deny-1', 'read_file', {
        path: `${projectA}/notes.md`,
      });

      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Denied: path outside project scope');
      expect(readCalled).toBe(false);
    });

    it('missing scope denies list_directory', async () => {
      let called = false;
      setMockInvokeHandler('list_files_shallow', () => {
        called = true;
        return [];
      });

      const result = await executeToolCall('default-deny-2', 'list_directory', {
        path: `${projectA}/src`,
      });

      expect(result.is_error).toBe(true);
      expect(called).toBe(false);
    });

    it('missing scope denies write_file', async () => {
      let called = false;
      setMockInvokeHandler('write_file', () => {
        called = true;
        return undefined;
      });

      const result = await executeToolCall('default-deny-3', 'write_file', {
        path: `${projectA}/out.md`,
        content: 'x',
      });

      expect(result.is_error).toBe(true);
      expect(called).toBe(false);
    });

    it('does not affect non-filesystem tools (web_search)', async () => {
      setMockInvokeHandler('web_search', () => [
        { title: 'T', url: 'https://x', snippet: 's' },
      ]);

      const result = await executeToolCall(
        'ok-websearch',
        'web_search',
        { query: 'test' },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(false);
      expect(result.content).toContain('https://x');
    });

    // Audit 2026-11-22 §6: these tools run in the unsandboxed main process,
    // so the spelling of a path must not get it past the scope check.
    it.each([
      ['a system prefix as a springboard', '/tmp/../Users/tester/.ssh/id_rsa'],
      ['climbing out of the project root', `${projectA}/../../.aws/credentials`],
      ['a relative path (the backend resolves it against its own cwd)', 'Users/tester/.ssh/id_rsa'],
      ['a relative path that happens to name the project', 'Users/tester/Projects/project-a/notes.md'],
      ['a ~ path', '~/.ssh/id_rsa'],
      ['a sibling sharing the root as a prefix', `${projectA}-extra/file`],
      ['a credential under ~/.config', `${homeDir}/.config/gh/hosts.yml`],
    ])('denies read_file, list_directory and write_file for %s', async (_label, path) => {
      const invoked: string[] = [];
      for (const cmd of ['read_file', 'list_files_shallow', 'write_file']) {
        setMockInvokeHandler(cmd, () => {
          invoked.push(cmd);
          return cmd === 'list_files_shallow' ? [] : 'secret';
        });
      }
      const scope = { projectRoots: [projectA], homeDir };

      const results = [
        await executeToolCall('t-read', 'read_file', { path }, scope),
        await executeToolCall('t-list', 'list_directory', { path }, scope),
        await executeToolCall('t-write', 'write_file', { path, content: 'x' }, scope),
      ];

      for (const result of results) {
        expect(result.is_error).toBe(true);
        expect(result.content).toBe('Denied: path outside project scope');
      }
      expect(invoked).toEqual([]);
    });

    it('hands the backend the normalised path that was checked, not the model\'s spelling', async () => {
      let seen: unknown;
      setMockInvokeHandler('read_file', (args) => {
        seen = args?.path;
        return 'ok';
      });

      const result = await executeToolCall(
        't-norm',
        'read_file',
        { path: `${projectA}/sub/.././notes.md` },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(false);
      expect(seen).toBe(`${projectA}/notes.md`);
    });

    it('does not affect non-filesystem tools when scope is missing', async () => {
      setMockInvokeHandler('web_search', () => []);

      const result = await executeToolCall('ok-websearch-noscope', 'web_search', {
        query: 'test',
      });

      expect(result.is_error).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Implicit-filesystem tools — model-provided paths gated like primitives
    // -------------------------------------------------------------------------

    function resetDocStores() {
      useEditorStore.setState({ openDocuments: [], activeTabId: null });
      useWorkspaceStore.setState({ projects: [], explorerFolders: [] });
      useSettingsStore.setState({ notesRootPath: '/Users/tester/Notesage' });
      useCommentStore.setState({ commentsByDocument: {} });
    }

    it('denies add_comments with out-of-scope file_path', async () => {
      resetDocStores();
      useWorkspaceStore.setState({
        projects: [{ path: projectB, fileTree: [] }],
      });

      let readCalled = false;
      setMockInvokeHandler('read_file', () => {
        readCalled = true;
        return '---\nid: leaked-uuid\n---\n# secret content';
      });

      const result = await executeToolCall(
        'attack-add-comments',
        'add_comments',
        {
          file_path: `${projectB}/secrets.md`,
          comments: [{ anchor_text: 'secret', body: 'leaked' }],
        },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Denied: path outside project scope');
      expect(readCalled).toBe(false);
    });

    it('denies list_comments with out-of-scope file_path', async () => {
      resetDocStores();
      useWorkspaceStore.setState({
        projects: [{ path: projectB, fileTree: [] }],
      });

      let readCalled = false;
      setMockInvokeHandler('read_file', () => {
        readCalled = true;
        return '---\nid: leaked-uuid\n---\n';
      });

      const result = await executeToolCall(
        'attack-list-comments',
        'list_comments',
        { file_path: `${projectB}/private.md` },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Denied: path outside project scope');
      expect(readCalled).toBe(false);
    });

    it('denies resolve_comments with out-of-scope file_path', async () => {
      resetDocStores();
      useWorkspaceStore.setState({
        projects: [{ path: projectB, fileTree: [] }],
      });

      let readCalled = false;
      setMockInvokeHandler('read_file', () => {
        readCalled = true;
        return '---\nid: leaked-uuid\n---\n';
      });

      const result = await executeToolCall(
        'attack-resolve-comments',
        'resolve_comments',
        {
          file_path: `${projectB}/notes.md`,
          comment_ids: ['c1'],
        },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Denied: path outside project scope');
      expect(readCalled).toBe(false);
    });

    it('denies generate_pptx with out-of-scope output_path', async () => {
      resetDocStores();

      let saveCalled = false;
      setMockInvokeHandler('export_pptx', () => [0x50, 0x4b]);
      setMockInvokeHandler('save_binary_file', () => {
        saveCalled = true;
        return undefined;
      });

      const result = await executeToolCall(
        'attack-pptx',
        'generate_pptx',
        {
          markdown: '# Slides',
          template: 'simple',
          output_path: `${projectB}/exfil.pptx`,
        },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Denied: path outside project scope');
      expect(saveCalled).toBe(false);
    });

    it('allows generate_pptx with no output_path — derived path is not model-controlled', async () => {
      resetDocStores();
      setActiveTabAt(`${projectA}/slides.md`);

      setMockInvokeHandler('read_file', () => '# Slides');
      setMockInvokeHandler('export_pptx', () => [0x50, 0x4b]);
      let savedPath: string | undefined;
      setMockInvokeHandler('save_binary_file', (args) => {
        savedPath = args?.path as string;
        return undefined;
      });

      const result = await executeToolCall(
        'ok-pptx-derived',
        'generate_pptx',
        { template: 'simple' },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(false);
      expect(savedPath).toBe(`${projectA}/slides.pptx`);
    });

    it('allows add_comments without file_path (active-tab path is not model-controlled)', async () => {
      resetDocStores();
      useWorkspaceStore.setState({
        projects: [{ path: projectA, fileTree: [] }],
      });
      setActiveTabAt(`${projectA}/doc.md`, 'doc-uuid-allow-1');
      useCommentStore.setState({
        commentsByDocument: { 'doc-uuid-allow-1': [] },
        saveComments: vi.fn().mockResolvedValue(undefined),
      });

      const result = await executeToolCall(
        'ok-add-comments-active',
        'add_comments',
        { comments: [{ anchor_text: 'whatever', body: 'note' }] },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(false);
      expect(result.content).toContain('Added 0');
    });

    it('allows list_comments without file_path (active-tab path is not model-controlled)', async () => {
      resetDocStores();
      useWorkspaceStore.setState({
        projects: [{ path: projectA, fileTree: [] }],
      });
      setActiveTabAt(`${projectA}/doc.md`, 'doc-uuid-allow-2');
      useCommentStore.setState({ commentsByDocument: { 'doc-uuid-allow-2': [] } });

      const result = await executeToolCall(
        'ok-list-comments-active',
        'list_comments',
        {},
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(false);
      expect(result.content).toBe('No comments found on this document.');
    });

    it('allows resolve_comments without file_path (active-tab path is not model-controlled)', async () => {
      resetDocStores();
      useWorkspaceStore.setState({
        projects: [{ path: projectA, fileTree: [] }],
      });
      setActiveTabAt(`${projectA}/doc.md`, 'doc-uuid-allow-3');
      useCommentStore.setState({
        commentsByDocument: { 'doc-uuid-allow-3': [] },
        saveComments: vi.fn().mockResolvedValue(undefined),
      });

      const result = await executeToolCall(
        'ok-resolve-comments-active',
        'resolve_comments',
        { comment_ids: ['nonexistent'] },
        { projectRoots: [projectA], homeDir },
      );

      expect(result.is_error).toBe(false);
      expect(result.content).toContain('Resolved 0');
    });
  });
});

function setActiveTabAt(filePath: string, frontmatterId?: string) {
  const tab = {
    id: 'tab-scope-1',
    filePath,
    fileName: filePath.split('/').pop() || 'file.md',
    content: '',
    contentLoaded: true,
    isDirty: false,
    frontmatter: frontmatterId ? { id: frontmatterId } : null,
    fileType: 'markdown' as const,
  };
  useEditorStore.setState({ openDocuments: [tab], activeTabId: 'tab-scope-1' });
}

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
