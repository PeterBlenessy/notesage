import { create } from "zustand";
import { persist } from "zustand/middleware";

type PdfFitMode = "width" | "page" | null;

interface PdfBookmark {
  /** Page number (1-based) for restoring reading position */
  page: number;
}

interface PdfStore {
  /** Global viewing preferences */
  fitMode: PdfFitMode;
  zoomIndex: number;

  /** Per-file reading position, keyed by absolute file path */
  bookmarks: Record<string, PdfBookmark>;

  setFitMode: (mode: PdfFitMode) => void;
  setZoomIndex: (index: number) => void;
  setBookmark: (filePath: string, page: number) => void;
  getBookmark: (filePath: string) => PdfBookmark | null;
}

export const usePdfStore = create<PdfStore>()(
  persist(
    (set, get) => ({
      fitMode: "width",
      zoomIndex: 7, // 1.0 (DEFAULT_ZOOM_INDEX)
      bookmarks: {},

      setFitMode: (mode) => set({ fitMode: mode }),

      setZoomIndex: (index) => set({ zoomIndex: index }),

      setBookmark: (filePath, page) =>
        set((state) => ({
          bookmarks: {
            ...state.bookmarks,
            [filePath]: { page },
          },
        })),

      getBookmark: (filePath) => get().bookmarks[filePath] ?? null,
    }),
    { name: "pdf-store" },
  ),
);
