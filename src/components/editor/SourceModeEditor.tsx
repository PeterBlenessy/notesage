import { useState, useEffect, useRef, useCallback } from "react";
import type { EditorView as CMEditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { SourceEditor } from "./SourceEditor";
import { SourceBubbleMenu } from "./SourceBubbleMenu";
import { parseFrontmatter, serializeFrontmatter } from "@/lib/frontmatter";
import { toast } from "sonner";
import type { Frontmatter } from "@/lib/frontmatter";

interface SourceModeEditorProps {
  /** The active tab's ID */
  tabId: string;
  /** The active tab's body content (without frontmatter) */
  content: string;
  /** The active tab's frontmatter */
  frontmatter: Frontmatter | null;
  /** Whether the tab has unsaved changes */
  isDirty: boolean;
  /** The active tab's file path */
  filePath: string;
  /** Whether word wrap is enabled */
  sourceWordWrap: boolean;
  /** Whether the floating toolbar (bubble menu) should be shown */
  showFloatingToolbar: boolean;
  /** Update tab content in the editor store */
  updateTabContent: (tabId: string, content: string, isDirty: boolean) => void;
  /** Update tab frontmatter in the editor store */
  setFrontmatter: (tabId: string, frontmatter: Frontmatter | null) => void;
  /** Save the file */
  saveFile: (filePath: string, content: string, tabId: string) => Promise<boolean>;
  /** Toggle between source and WYSIWYG mode */
  onToggleViewMode: () => void;
  /** Toggle word wrap */
  onToggleWordWrap: () => void;
  /** Callback when the CodeMirror view is created/destroyed (for Copilot integration) */
  onCmViewChange: (view: CMEditorView | null) => void;
}

/**
 * Source mode editor wrapper — manages CodeMirror content sync, find delegation,
 * and the source bubble menu. The actual CodeMirror editor lives in SourceEditor.
 */
export function SourceModeEditor({
  tabId,
  content,
  frontmatter,
  isDirty,
  filePath,
  sourceWordWrap,
  showFloatingToolbar,
  updateTabContent,
  setFrontmatter,
  saveFile,
  onToggleViewMode,
  onToggleWordWrap,
  onCmViewChange,
}: SourceModeEditorProps) {
  // Source mode: holds the full raw text (frontmatter + body) for CodeMirror
  const [sourceContent, setSourceContent] = useState("");
  // Prevents the init effect from clobbering user edits
  const sourceUserEditRef = useRef(false);
  const [cmView, setCmView] = useState<CMEditorView | null>(null);

  // Propagate cmView to parent for Copilot LSP integration
  useEffect(() => {
    onCmViewChange(cmView);
    return () => onCmViewChange(null);
  }, [cmView, onCmViewChange]);

  // Initialize source content when entering source mode, switching tabs, or on external change.
  // Skipped when the change came from the user editing in CodeMirror (sourceUserEditRef).
  useEffect(() => {
    if (sourceUserEditRef.current) {
      sourceUserEditRef.current = false;
      return;
    }
    const raw = serializeFrontmatter(frontmatter, content);
    setSourceContent(raw);
  }, [tabId, content, frontmatter]);

  // Listen for find-open events and delegate to CodeMirror's built-in search
  useEffect(() => {
    const handleFindOpen = () => {
      if (cmView) openSearchPanel(cmView);
    };
    const handleFindReplaceOpen = () => {
      if (cmView) openSearchPanel(cmView);
    };
    window.addEventListener("notesage:find-open", handleFindOpen);
    window.addEventListener("notesage:find-replace-open", handleFindReplaceOpen);
    return () => {
      window.removeEventListener("notesage:find-open", handleFindOpen);
      window.removeEventListener("notesage:find-replace-open", handleFindReplaceOpen);
    };
  }, [cmView]);

  const handleUpdate = useCallback((raw: string) => {
    sourceUserEditRef.current = true;
    setSourceContent(raw);
    const { frontmatter: fm, content: body } = parseFrontmatter(raw);
    const bodyChanged = body !== content;
    const fmChanged = JSON.stringify(fm) !== JSON.stringify(frontmatter);
    updateTabContent(tabId, body, isDirty || bodyChanged || fmChanged);
    if (fmChanged) setFrontmatter(tabId, fm);
  }, [tabId, content, frontmatter, isDirty, updateTabContent, setFrontmatter]);

  const handleSave = useCallback(async () => {
    if (isDirty) {
      try {
        await saveFile(filePath, content, tabId);
      } catch (error) {
        toast.error(`Failed to save file: ${error}`);
      }
    }
  }, [isDirty, filePath, content, tabId, saveFile]);

  return (
    <div className="flex-1 overflow-auto relative">
      <SourceEditor
        content={sourceContent}
        wordWrap={sourceWordWrap}
        onUpdate={handleUpdate}
        onSave={handleSave}
        onToggleViewMode={onToggleViewMode}
        onToggleWordWrap={onToggleWordWrap}
        onViewReady={setCmView}
      />
      {showFloatingToolbar && <SourceBubbleMenu cmView={cmView} />}
    </div>
  );
}
