import { useState, useCallback, useEffect, useMemo } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { isUriInScope, type UriScope } from '@/lib/ai/uri-scope';

export interface ContextItem {
  id: string;
  type: 'file';
  label: string;
  path: string;
  dismissed: boolean;
}

/**
 * Offer surface for out-of-scope active tabs. When a user is editing a file
 * that isn't under any selected project (or the notes root), we intentionally
 * do NOT auto-attach it to chat — that would silently leak Project B content
 * into a Project A scoped conversation (task #23). Instead the consumer can
 * render an explicit "Add to chat" affordance for this offer so the user can
 * still opt in manually.
 */
export interface ExplicitAttachOffer {
  path: string;
  label: string;
}

export interface UseChatContextReturn {
  contextItems: ContextItem[];
  attachedFilePaths: string[];
  dismissItem: (id: string) => void;
  /**
   * Populated when the active tab exists but sits outside the currently
   * scoped projects (and the notes root). `null` when the active tab is
   * in-scope (already auto-attached) or there is no active tab.
   */
  explicitAttachOffer: ExplicitAttachOffer | null;
  /**
   * Opt-in attach for out-of-scope files. Called by consumers rendering the
   * `explicitAttachOffer` affordance. No-op for already-attached paths.
   */
  attachExplicit: (path: string, label: string) => void;
}

export function useChatContext(): UseChatContextReturn {
  const [items, setItems] = useState<ContextItem[]>([]);

  const activeFilePath = useEditorStore((s) => {
    if (!s.activeTabId) return null;
    return s.openDocuments.find((t) => t.id === s.activeTabId)?.filePath ?? null;
  });
  const activeFileName = useEditorStore((s) => {
    if (!s.activeTabId) return null;
    return s.openDocuments.find((t) => t.id === s.activeTabId)?.fileName ?? null;
  });

  // Scope inputs — kept in sync with the project isolation policy enforced
  // across #8 (direct-API tool executor), #16/#17 (LSP URI gate), and #18
  // (per-project skill registry). Empty `selectedProjectPaths` collapses to
  // "notes root only" rather than silently allowing everything.
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const homeDir = useSettingsStore((s) => s.homeDir);
  const resolvedNotesRoot = useMemo(() => {
    if (!notesRootPath) return null;
    if (notesRootPath.startsWith('~')) {
      return homeDir ? notesRootPath.replace('~', homeDir) : null;
    }
    return notesRootPath;
  }, [notesRootPath, homeDir]);

  const scope: UriScope = useMemo(
    () => ({ projectRoots: selectedProjectPaths, notesRootPath: resolvedNotesRoot }),
    [selectedProjectPaths, resolvedNotesRoot],
  );

  const activeInScope = useMemo(() => {
    if (!activeFilePath) return false;
    return isUriInScope(activeFilePath, scope);
  }, [activeFilePath, scope]);

  // Reset items when active tab path OR scope changes. Out-of-scope tabs
  // produce NO auto-attached item — consumers must opt in explicitly via
  // `attachExplicit`.
  useEffect(() => {
    if (!activeFilePath || !activeFileName) {
      setItems([]);
      return;
    }
    if (!activeInScope) {
      setItems([]);
      return;
    }
    setItems([
      {
        id: activeFilePath,
        type: 'file',
        label: activeFileName,
        path: activeFilePath,
        dismissed: false,
      },
    ]);
  }, [activeFilePath, activeFileName, activeInScope]);

  const dismissItem = useCallback((id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, dismissed: true } : item)));
  }, []);

  const attachExplicit = useCallback((path: string, label: string) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.id === path);
      if (existing) {
        // Re-attach a previously dismissed pill without duplicating it.
        return prev.map((item) => (item.id === path ? { ...item, dismissed: false } : item));
      }
      return [...prev, { id: path, type: 'file', label, path, dismissed: false }];
    });
  }, []);

  const contextItems = useMemo(() => items.filter((item) => !item.dismissed), [items]);

  const attachedFilePaths = useMemo(() => contextItems.map((item) => item.path), [contextItems]);

  const explicitAttachOffer = useMemo<ExplicitAttachOffer | null>(() => {
    if (!activeFilePath || !activeFileName) return null;
    if (activeInScope) return null;
    // Suppress the offer when the user has already opted in for this path.
    if (contextItems.some((item) => item.path === activeFilePath)) return null;
    return { path: activeFilePath, label: activeFileName };
  }, [activeFilePath, activeFileName, activeInScope, contextItems]);

  return { contextItems, attachedFilePaths, dismissItem, explicitAttachOffer, attachExplicit };
}
