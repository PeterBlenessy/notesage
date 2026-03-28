import { invoke } from '@tauri-apps/api/core';
import { useSkillStore } from '@/stores/skill-store';
import type { SkillContent, ScriptResult } from '@/lib/tauri';
import type { ToolResult } from '@/lib/ai/types';

/**
 * Execute a tool call by name and return the result.
 * Routes to the appropriate Tauri command based on tool name.
 */
export async function executeToolCall(
  toolCallId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    let content: string;

    switch (name) {
      case 'web_search': {
        const query = args.query as string;
        if (!query) throw new Error('Missing required argument: query');
        const results = await invoke<Array<{ title: string; url: string; snippet: string }>>(
          'web_search',
          { query, maxResults: 5 }
        );
        if (results.length === 0) {
          content = 'No search results found.';
        } else {
          content = results.map((r, i) =>
            `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
          ).join('\n\n');
        }
        break;
      }

      case 'list_directory': {
        const path = args.path as string;
        if (!path) throw new Error('Missing required argument: path');
        interface FileEntry { name: string; path: string; is_directory: boolean; children?: FileEntry[] }
        const entries = await invoke<FileEntry[]>('list_files_shallow', { path });
        content = entries
          .map((e) => `${e.name}${e.is_directory ? '/' : ''}`)
          .join('\n');
        if (!content) content = '(empty directory)';
        break;
      }

      case 'read_file': {
        const path = args.path as string;
        if (!path) throw new Error('Missing required argument: path');
        content = await invoke<string>('read_file', { path });
        break;
      }

      case 'write_file': {
        const path = args.path as string;
        const fileContent = args.content as string;
        if (!path || fileContent === undefined)
          throw new Error('Missing required arguments: path, content');
        await invoke('write_file', { path, content: fileContent });
        content = `File written successfully: ${path}`;
        break;
      }

      case 'read_skill_content': {
        const skillName = args.skill_name as string;
        if (!skillName) throw new Error('Missing required argument: skill_name');
        const skill = useSkillStore.getState().getSkillByName(skillName);
        if (!skill) throw new Error(`Skill not found: ${skillName}`);
        const result = await invoke<SkillContent>('read_skill_content', {
          skillPath: skill.path,
        });
        content = `# ${result.name}\n\n${result.body}\n\nScripts: ${result.scripts.join(', ') || 'none'}\nReferences: ${result.references.join(', ') || 'none'}`;
        break;
      }

      case 'execute_skill_script': {
        const skillName = args.skill_name as string;
        const script = args.script as string;
        const scriptArgs = (args.args as string[]) || [];
        if (!skillName || !script)
          throw new Error('Missing required arguments: skill_name, script');
        const skill = useSkillStore.getState().getSkillByName(skillName);
        if (!skill) throw new Error(`Skill not found: ${skillName}`);
        const result = await invoke<ScriptResult>('execute_skill_script', {
          skillPath: skill.path,
          script,
          args: scriptArgs,
          workingDir: null,
          env: null,
          timeoutMs: null,
        });
        content = result.stdout;
        if (result.stderr) content += `\nSTDERR: ${result.stderr}`;
        if (result.exit_code !== 0) content += `\nExit code: ${result.exit_code}`;
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      tool_call_id: toolCallId,
      content,
      is_error: false,
    };
  } catch (error) {
    return {
      tool_call_id: toolCallId,
      content: error instanceof Error ? error.message : String(error),
      is_error: true,
    };
  }
}
