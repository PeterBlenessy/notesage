import { create } from "zustand";
import { persist } from "zustand/middleware";

type EpubViewMode = "scroll" | "paginated";

interface EpubBookmark {
  /** epubcfi string — precise reading position */
  cfi: string;
  /** Chapter label for display */
  chapter?: string;
}

interface EpubStore {
  /** Global viewing preferences */
  viewMode: EpubViewMode;

  /** Per-file reading position, keyed by absolute file path */
  bookmarks: Record<string, EpubBookmark>;

  setViewMode: (mode: EpubViewMode) => void;
  setBookmark: (filePath: string, cfi: string, chapter?: string) => void;
  getBookmark: (filePath: string) => EpubBookmark | null;
}

export const useEpubStore = create<EpubStore>()(
  persist(
    (set, get) => ({
      viewMode: "scroll",
      bookmarks: {},

      setViewMode: (mode) => set({ viewMode: mode }),

      setBookmark: (filePath, cfi, chapter) =>
        set((state) => ({
          bookmarks: {
            ...state.bookmarks,
            [filePath]: { cfi, chapter },
          },
        })),

      getBookmark: (filePath) => get().bookmarks[filePath] ?? null,
    }),
    { name: "epub-store" },
  ),
);
