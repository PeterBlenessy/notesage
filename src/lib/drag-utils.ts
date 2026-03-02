/** MIME type for internal drag-and-drop (text/plain for WKWebView compatibility) */
export const NOTESAGE_DRAG_MIME = "text/plain";

export interface NotesageDragPayload {
  _notesage: true;
  path: string;
  name: string;
  isDirectory: boolean;
}

/** Parse a Notesage drag-and-drop payload from a DragEvent. Returns null if not a valid Notesage drag. */
export function parseNotesageDrop(e: React.DragEvent): NotesageDragPayload | null {
  const raw = e.dataTransfer.getData(NOTESAGE_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed._notesage) return null;
    return parsed as NotesageDragPayload;
  } catch {
    return null;
  }
}
