import { invoke } from '@tauri-apps/api/core';
import { useSkillStore } from '@/stores/skill-store';
import type { SkillContent, ScriptResult, ArgMapping } from '@/lib/tauri';
import type { ToolResult } from '@/lib/ai/types';

/**
 * Convert structured JSON arguments to string[] for execute_skill_script,
 * using the arg_mapping from the SkillToolEntry.
 */
export function mapArgsToStringArray(
  args: Record<string, unknown>,
  argMapping: ArgMapping[],
): string[] {
  const result: string[] = [];

  // First, collect positional args in order
  const positionals = argMapping
    .filter((m) => m.mapping_type.type === 'Positional' || m.mapping_type.type === 'Spread')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const mapping of positionals) {
    const value = args[mapping.param_name];
    if (value === undefined || value === null) continue;

    if (mapping.mapping_type.type === 'Spread' && Array.isArray(value)) {
      result.push(...value.map(String));
    } else if (mapping.mapping_type.type === 'Positional') {
      result.push(String(value));
    }
  }

  // Then, add flag args
  const flags = argMapping.filter(
    (m) => m.mapping_type.type === 'Flag' || m.mapping_type.type === 'BoolFlag',
  );

  for (const mapping of flags) {
    const value = args[mapping.param_name];
    if (value === undefined || value === null) continue;

    if (mapping.mapping_type.type === 'BoolFlag' && value === true) {
      result.push(mapping.mapping_type.value.flag);
    } else if (mapping.mapping_type.type === 'Flag' && value) {
      result.push(mapping.mapping_type.value.flag);
      result.push(String(value));
    }
  }

  return result;
}

/**
 * Execute a skill tool call by routing through execute_skill_script.
 */
async function executeSkillTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const store = useSkillStore.getState();
  const skillTool = store.getSkillToolByName(toolName);

  if (!skillTool) {
    throw new Error(`Skill tool not found: ${toolName}`);
  }

  const skill = store.getSkillByName(skillTool.skill_name);
  if (!skill) {
    throw new Error(`Skill not found: ${skillTool.skill_name}`);
  }

  // For explicit schemas with no arg_mapping, pass args directly as string array
  const scriptArgs =
    skillTool.arg_mapping.length > 0
      ? mapArgsToStringArray(args, skillTool.arg_mapping)
      : // Explicit schema: try to extract args array or convert all values
        (args.args as string[]) ?? Object.values(args).map(String);

  const result = await invoke<ScriptResult>('execute_skill_script', {
    skillPath: skill.path,
    script: skillTool.script_path,
    args: scriptArgs,
    workingDir: null,
    env: null,
    timeoutMs: null,
  });

  let content = result.stdout;
  if (result.stderr) content += `\nSTDERR: ${result.stderr}`;
  if (result.exit_code !== 0) content += `\nExit code: ${result.exit_code}`;
  return content;
}

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

      default: {
        // Skill tool routing: skill__{skill}__{script}
        if (name.startsWith('skill__')) {
          content = await executeSkillTool(name, args);
          break;
        }
        throw new Error(`Unknown tool: ${name}`);
      }
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
