/**
 * A tiny module, shown to demonstrate Notesage's code editor:
 * CodeMirror 6 with syntax highlighting, line numbers, and fold gutters.
 */

export interface Note {
  id: string;
  title: string;
  tags: string[];
  wordCount: number;
}

/** Return the notes whose tag set includes every requested tag. */
export function filterByTags(notes: Note[], required: string[]): Note[] {
  return notes.filter((note) =>
    required.every((tag) => note.tags.includes(tag)),
  );
}

/** Total words across a collection — the status bar reads this. */
export const totalWords = (notes: Note[]): number =>
  notes.reduce((sum, note) => sum + note.wordCount, 0);

// A calm default, in case nothing is open yet.
const WELCOME: Note = {
  id: "welcome",
  title: "On Attention",
  tags: ["attention", "writing"],
  wordCount: 260,
};

console.log(`Ready: ${WELCOME.title} (${WELCOME.wordCount} words)`);
