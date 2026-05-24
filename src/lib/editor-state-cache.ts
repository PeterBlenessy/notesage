import type { EditorState } from "@tiptap/pm/state";

const MAX_ENTRIES = 10;

export class EditorStateCache {
  private entries = new Map<string, EditorState>();

  get(filePath: string): EditorState | undefined {
    const state = this.entries.get(filePath);
    if (!state) return undefined;
    this.entries.delete(filePath);
    this.entries.set(filePath, state);
    return state;
  }

  set(filePath: string, state: EditorState): void {
    if (this.entries.has(filePath)) this.entries.delete(filePath);
    this.entries.set(filePath, state);
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(filePath: string): boolean {
    return this.entries.delete(filePath);
  }

  has(filePath: string): boolean {
    return this.entries.has(filePath);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}
