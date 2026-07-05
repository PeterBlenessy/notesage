import { invoke } from '@tauri-apps/api/core';
import { useSkillStore } from '@/stores/skill-store';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useCommentStore } from '@/stores/comment-store';
import { getEditorRef } from '@/lib/editor-bridge';
import { findTextInDoc } from '@/lib/pm-text-search';
import { setCommentDecorations } from '@/components/editor/extensions/comment-mark';
import type { SkillContent, ScriptResult, ArgMapping, PptxTemplateInfo, WebSearchResult } from '@/lib/tauri';
import type { ToolResult } from '@/lib/ai/types';
import { isToolCallAllowed, isPathAllowed } from '@/lib/ai/path-filter';
import { hashPath } from '@/lib/comment-storage';

export interface ToolCallScope {
  projectRoots: string[];
  homeDir: string;
}

const SCOPE_DENIAL_MESSAGE = 'Denied: path outside project scope';

const FILESYSTEM_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'list_directory',
  'write_file',
]);

/**
 * Gate a single model-provided path against the chat scope. Used by tools
 * whose IPC fan-out is not visible to `isToolCallAllowed` (e.g. comments
 * tools that invoke `read_file` internally, or `generate_pptx` writing a
 * model-supplied `output_path`). Missing scope = deny, matching the
 * primitive filesystem-tool gate.
 */
function denyIfPathOutOfScope(
  path: string,
  scope: ToolCallScope | undefined,
  toolCallId: string,
): ToolResult | null {
  const roots = scope?.projectRoots ?? [];
  const homeDir = scope?.homeDir ?? '';
  if (isPathAllowed(path, roots, homeDir)) return null;
  return {
    tool_call_id: toolCallId,
    content: SCOPE_DENIAL_MESSAGE,
    is_error: true,
  };
}

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

interface CommentContext {
  commentKey: string;
  storageRoot: string;
  fileName: string;
  isActiveTab: boolean;
}

/** Get the comment key and storage root for the active document. */
function getCommentContextForActiveTab(): CommentContext | null {
  const editorState = useEditorStore.getState();
  const activeTab = editorState.openDocuments.find((t) => t.id === editorState.activeTabId);
  if (!activeTab?.filePath) return null;

  const projects = useWorkspaceStore.getState().projects;
  const project = projects.find((p) => activeTab.filePath.startsWith(p.path + '/'));
  const isProjectFile = !!project;

  const documentId = (activeTab.frontmatter?.id as string) ?? null;
  const commentKey = isProjectFile ? documentId : hashPath(activeTab.filePath);
  if (!commentKey) return null;

  const notesRootPath = useSettingsStore.getState().notesRootPath;
  const storageRoot = project?.path ?? (notesRootPath && !notesRootPath.startsWith('~') ? notesRootPath : null);
  if (!storageRoot) return null;

  const fileName = activeTab.fileName || activeTab.filePath.split('/').pop() || 'document';
  return { commentKey, storageRoot, fileName, isActiveTab: true };
}

/**
 * Get the comment key and storage root for any file path.
 * Reads frontmatter from disk to extract the document UUID if available.
 */
async function getCommentContextForPath(filePath: string): Promise<CommentContext | null> {
  // Check if this file is the active tab — if so, use the in-memory state (has frontmatter)
  const activeCtx = getCommentContextForActiveTab();
  const editorState = useEditorStore.getState();
  const activeTab = editorState.openDocuments.find((t) => t.id === editorState.activeTabId);
  if (activeCtx && activeTab?.filePath === filePath) return activeCtx;

  // Find project for this path
  const projects = useWorkspaceStore.getState().projects;
  const project = projects.find((p) => filePath.startsWith(p.path + '/'));
  const isProjectFile = !!project;

  // Derive comment key — for project files, read frontmatter UUID from disk
  let commentKey: string;
  if (isProjectFile) {
    try {
      const raw = await invoke<string>('read_file', { path: filePath });
      // Simple frontmatter UUID extraction
      const match = raw.match(/^---\n[\s\S]*?^id:\s*(.+)$/m);
      commentKey = match?.[1]?.trim() || hashPath(filePath);
    } catch {
      commentKey = hashPath(filePath);
    }
  } else {
    commentKey = hashPath(filePath);
  }

  const notesRootPath = useSettingsStore.getState().notesRootPath;
  const storageRoot = project?.path ?? (notesRootPath && !notesRootPath.startsWith('~') ? notesRootPath : null);
  if (!storageRoot) return null;

  const fileName = filePath.split('/').pop() || 'document';
  return { commentKey, storageRoot, fileName, isActiveTab: false };
}

/** Get comment context — from file_path arg if provided, otherwise active tab. */
async function getCommentContext(filePath?: string): Promise<CommentContext | null> {
  if (filePath) return getCommentContextForPath(filePath);
  return getCommentContextForActiveTab();
}

/**
 * Execute a tool call by name and return the result.
 * Routes to the appropriate Tauri command based on tool name.
 *
 * `scope` constrains filesystem-touching tools (`read_file`, `list_directory`,
 * `write_file`) to paths inside the chat's selected project roots. A missing
 * `scope` is treated as deny for those tools — the secure default. Non-FS
 * tools are unaffected.
 */
export async function executeToolCall(
  toolCallId: string,
  name: string,
  args: Record<string, unknown>,
  scope?: ToolCallScope,
): Promise<ToolResult> {
  try {
    if (FILESYSTEM_TOOLS.has(name)) {
      const roots = scope?.projectRoots ?? [];
      const homeDir = scope?.homeDir ?? '';
      const check = isToolCallAllowed(name, JSON.stringify(args), roots, homeDir);
      if (!check.allowed) {
        return {
          tool_call_id: toolCallId,
          content: SCOPE_DENIAL_MESSAGE,
          is_error: true,
        };
      }
    }

    let content: string;

    switch (name) {
      case 'web_search': {
        const query = args.query as string;
        if (!query) throw new Error('Missing required argument: query');
        const results = await invoke<WebSearchResult[]>(
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
        interface FileEntry { name: string; path: string; is_directory: boolean; hidden: boolean; children?: FileEntry[] }
        const entries = await invoke<FileEntry[]>('list_files_shallow', { path, showHidden: true });
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

      case 'add_comments': {
        const comments = args.comments as Array<{ anchor_text: string; body: string; occurrence?: number }>;
        if (!comments || !Array.isArray(comments)) throw new Error('Missing required argument: comments');

        const filePathArg = args.file_path as string | undefined;
        if (filePathArg) {
          const denial = denyIfPathOutOfScope(filePathArg, scope, toolCallId);
          if (denial) return denial;
        }

        const ctx = await getCommentContext(filePathArg);
        if (!ctx) throw new Error('Cannot determine document context — provide file_path or open a document');

        const { commentKey, storageRoot, fileName, isActiveTab } = ctx;
        const commentStore = useCommentStore.getState();
        let added = 0;
        const skipped: string[] = [];

        if (isActiveTab) {
          // Active tab — use ProseMirror positions (accurate)
          const editor = getEditorRef();
          if (!editor) throw new Error('Editor not available');

          for (const c of comments) {
            const range = findTextInDoc(editor.state.doc, c.anchor_text, c.occurrence ?? 1);
            if (!range) {
              skipped.push(c.anchor_text.length > 60 ? c.anchor_text.slice(0, 60) + '\u2026' : c.anchor_text);
              continue;
            }
            commentStore.addComment({
              documentId: commentKey,
              anchorText: c.anchor_text,
              from: range.from,
              to: range.to,
              body: c.body,
              author: 'AI',
              status: 'open',
            });
            added++;
          }

          // Refresh decorations
          const allComments = useCommentStore.getState().commentsByDocument[commentKey] ?? [];
          setCommentDecorations(editor, allComments.filter((c) => c.status !== 'resolved'));
        } else {
          // Non-active file — use raw text positions (re-anchored when file opens)
          const filePath = args.file_path as string;
          const raw = await invoke<string>('read_file', { path: filePath });

          for (const c of comments) {
            const occurrence = c.occurrence ?? 1;
            let searchFrom = 0;
            let foundIdx = -1;
            for (let i = 0; i < occurrence; i++) {
              foundIdx = raw.indexOf(c.anchor_text, searchFrom);
              if (foundIdx === -1) break;
              searchFrom = foundIdx + 1;
            }

            if (foundIdx === -1) {
              skipped.push(c.anchor_text.length > 60 ? c.anchor_text.slice(0, 60) + '\u2026' : c.anchor_text);
              continue;
            }

            commentStore.addComment({
              documentId: commentKey,
              anchorText: c.anchor_text,
              from: foundIdx,
              to: foundIdx + c.anchor_text.length,
              body: c.body,
              author: 'AI',
              status: 'open',
            });
            added++;
          }
        }

        // Persist
        await commentStore.saveComments(commentKey, storageRoot);

        content = `Added ${added} comment${added !== 1 ? 's' : ''} to ${fileName}`;
        if (skipped.length > 0) {
          content += `\nSkipped ${skipped.length} (anchor text not found): ${skipped.map(s => `"${s}"`).join(', ')}`;
        }
        break;
      }

      case 'list_comments': {
        const filePathArg = args.file_path as string | undefined;
        if (filePathArg) {
          const denial = denyIfPathOutOfScope(filePathArg, scope, toolCallId);
          if (denial) return denial;
        }
        const ctx = await getCommentContext(filePathArg);
        if (!ctx) throw new Error('Cannot determine document context — provide file_path or open a document');

        const { commentKey, storageRoot } = ctx;

        // Load comments from disk if not already in memory
        let comments = useCommentStore.getState().commentsByDocument[commentKey];
        if (!comments) {
          await useCommentStore.getState().loadComments(commentKey, storageRoot);
          comments = useCommentStore.getState().commentsByDocument[commentKey] ?? [];
        }

        if (comments.length === 0) {
          content = 'No comments found on this document.';
        } else {
          content = comments.map((c) => {
            const replyCount = c.replies?.length ?? 0;
            return `[${c.id}] Status: ${c.status ?? 'open'} | Anchor: "${c.anchorText}"\n${c.body}\nReplies: ${replyCount}`;
          }).join('\n\n');
        }
        break;
      }

      case 'resolve_comments': {
        const commentIds = args.comment_ids as string[];
        if (!commentIds || !Array.isArray(commentIds)) throw new Error('Missing required argument: comment_ids');

        const filePathArg = args.file_path as string | undefined;
        if (filePathArg) {
          const denial = denyIfPathOutOfScope(filePathArg, scope, toolCallId);
          if (denial) return denial;
        }

        const ctx = await getCommentContext(filePathArg);
        if (!ctx) throw new Error('Cannot determine document context — provide file_path or open a document');

        const { commentKey, storageRoot, isActiveTab } = ctx;
        const commentStore = useCommentStore.getState();

        // Load comments from disk if not already in memory
        if (!commentStore.commentsByDocument[commentKey]) {
          await commentStore.loadComments(commentKey, storageRoot);
        }

        const existing = useCommentStore.getState().commentsByDocument[commentKey] ?? [];
        let resolved = 0;
        const notFound: string[] = [];

        for (const id of commentIds) {
          const found = existing.find((c) => c.id === id);
          if (found) {
            useCommentStore.getState().setCommentStatus(commentKey, id, 'resolved');
            resolved++;
          } else {
            notFound.push(id);
          }
        }

        // Refresh decorations if this is the active tab
        if (isActiveTab) {
          const editor = getEditorRef();
          if (editor) {
            const allComments = useCommentStore.getState().commentsByDocument[commentKey] ?? [];
            setCommentDecorations(editor, allComments.filter((c) => c.status !== 'resolved'));
          }
        }

        // Persist
        await useCommentStore.getState().saveComments(commentKey, storageRoot);

        content = `Resolved ${resolved} comment${resolved !== 1 ? 's' : ''}`;
        if (notFound.length > 0) {
          content += `\nNot found: ${notFound.join(', ')}`;
        }
        break;
      }

      case 'generate_pptx': {
        const template = args.template as string | undefined;
        const outputPath = args.output_path as string | undefined;
        const markdownArg = args.markdown as string | undefined;

        if (outputPath) {
          const denial = denyIfPathOutOfScope(outputPath, scope, toolCallId);
          if (denial) return denial;
        }

        // Get markdown content
        let markdown: string;
        let sourcePath: string | undefined;
        if (markdownArg) {
          markdown = markdownArg;
        } else {
          const editorState = useEditorStore.getState();
          const activeTab = editorState.openDocuments.find((t) => t.id === editorState.activeTabId);
          if (!activeTab?.filePath) throw new Error('No active document — open a file or provide markdown content');
          sourcePath = activeTab.filePath;
          markdown = await invoke<string>('read_file', { path: sourcePath });
        }

        // Template is required — ask user if not provided
        if (!template) {
          // List available templates
          const projects = useWorkspaceStore.getState().projects;
          const editorState = useEditorStore.getState();
          const activeTab = editorState.openDocuments.find((t) => t.id === editorState.activeTabId);
          const project = activeTab ? projects.find((p) => activeTab.filePath.startsWith(p.path + '/')) : null;

          let templateList = 'Built-in templates: simple, business, report';
          try {
            const customTemplates = await invoke<PptxTemplateInfo[]>('list_pptx_templates', {
              projectRoot: project?.path ?? null,
            });
            if (customTemplates.length > 0) {
              templateList += `\nCustom templates: ${customTemplates.map((t) => t.name).join(', ')}`;
            }
          } catch {
            // Ignore template listing errors
          }

          content = `Please ask the user which template they prefer. Available options:\n${templateList}`;
          break;
        }

        // Extract title from first heading or filename
        const headingMatch = markdown.match(/^#\s+(.+)$/m);
        const title = headingMatch?.[1] ?? (sourcePath ? sourcePath.split('/').pop()?.replace(/\.\w+$/, '') ?? 'Presentation' : 'Presentation');

        // Generate PPTX
        const pptxBytes = await invoke<number[]>('export_pptx', {
          markdown,
          title,
          template,
        });

        // Determine output path
        const outPath = outputPath ?? (sourcePath ? sourcePath.replace(/\.\w+$/, '.pptx') : null);
        if (!outPath) throw new Error('Cannot determine output path — provide output_path or open a document');

        // Save to disk
        await invoke('save_binary_file', { path: outPath, data: pptxBytes });

        content = `Presentation saved to ${outPath} (${template} template)`;
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
