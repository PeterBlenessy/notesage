import { useState, useCallback, useEffect, useMemo } from 'react';
import { useEditorStore } from '@/stores/editor-store';

export interface ContextItem {
  id: string;
  type: 'file';
  label: string;
  path: string;
  dismissed: boolean;
}

export function useChatContext() {
  const [items, setItems] = useState<ContextItem[]>([]);

  const activeFilePath = useEditorStore((s) => {
    if (!s.activeTabId) return null;
    return s.tabs.find((t) => t.id === s.activeTabId)?.filePath ?? null;
  });
  const activeFileName = useEditorStore((s) => {
    if (!s.activeTabId) return null;
    return s.tabs.find((t) => t.id === s.activeTabId)?.fileName ?? null;
  });

  // Reset items when active tab file path changes
  useEffect(() => {
    if (!activeFilePath || !activeFileName) {
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
  }, [activeFilePath, activeFileName]);

  const dismissItem = useCallback((id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, dismissed: true } : item)));
  }, []);

  const contextItems = useMemo(() => items.filter((item) => !item.dismissed), [items]);

  const attachedFilePaths = useMemo(() => contextItems.map((item) => item.path), [contextItems]);

  return { contextItems, attachedFilePaths, dismissItem };
}
