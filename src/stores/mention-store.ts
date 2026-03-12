import { create } from "zustand";

interface MentionStore {
  /** All known mentions (without @ prefix), sorted */
  mentions: string[];
  /** Map of mention name → file paths containing that mention */
  filesByMention: Record<string, string[]>;
  /** Replace both mentions and file mapping from a scan result */
  setScanResult: (filesByMention: Record<string, string[]>) => void;
}

export const useMentionStore = create<MentionStore>((set) => ({
  mentions: [],
  filesByMention: {},
  setScanResult: (filesByMention) =>
    set({ mentions: Object.keys(filesByMention).sort(), filesByMention }),
}));
