/**
 * The native navigation stack, derived from the store (PRD
 * `docs/prds/2026-09-06-ios-native-navigation.md`).
 *
 * The mobile store has always described where you are — `folderStack`,
 * `openDoc`, `docStack`, `homeEditorOpen` — it simply rendered one of them at
 * a time. A `UINavigationController` wants the same thing as a LIST, so this
 * turns one into the other, and works out the pushes and pops that get the
 * native stack from where it is to where the store says it should be.
 *
 * Pure, and separate from the hook that performs the calls, because every
 * interesting case here is a sequence — open two folders and a document, pop
 * two at once, follow a link trail — and none of them should need a phone to
 * check.
 */

export interface NavScreen {
  /** Stable identity. `""` is Home; a folder is its relative path; a document
   *  is `doc:<relPath>`; the Home editor is `home-editor`. */
  id: string;
  /** What the navigation bar shows. */
  title: string;
}

export interface NavStackInputs {
  folderStack: { relPath: string; name: string }[];
  docStack: { relPath: string; name: string }[];
  openDoc: { relPath: string; name: string } | null;
  homeEditorOpen: boolean;
  /** What the root is called. */
  rootTitle: string;
  /** The Home editor's title. */
  homeEditorTitle: string;
}

/** Document ids are prefixed so a document can never collide with a folder of
 *  the same relative path — which is exactly what a note and its folder are. */
export function documentScreenId(relPath: string): string {
  return `doc:${relPath}`;
}

/**
 * Where the store says we are, as a stack.
 *
 * Order matters and mirrors how the app actually nests: folders, then the
 * link trail of documents, then the document on screen. The Home editor is a
 * screen pushed from Home and nothing nests inside it.
 */
export function deriveNavStack(input: NavStackInputs): NavScreen[] {
  const screens: NavScreen[] = [{ id: "", title: input.rootTitle }];
  if (input.homeEditorOpen) {
    screens.push({ id: "home-editor", title: input.homeEditorTitle });
    return screens;
  }
  for (const folder of input.folderStack) {
    screens.push({ id: folder.relPath, title: folder.name });
  }
  // The trail BELOW the open document: following three links and pressing
  // Back should retrace them, which is exactly what a stack does.
  for (const doc of input.docStack) {
    screens.push({ id: documentScreenId(doc.relPath), title: doc.name });
  }
  if (input.openDoc) {
    screens.push({ id: documentScreenId(input.openDoc.relPath), title: input.openDoc.name });
  }
  return screens;
}

export interface NavStackDiff {
  /** How many controllers to pop, from the top. */
  pops: number;
  /** What to push afterwards, in order. */
  pushes: NavScreen[];
}

/**
 * The moves that take `current` to `next`.
 *
 * Common prefix first, then pop what is above it and push what is missing.
 * Renaming a folder changes its title but not its id, so a title-only change
 * is neither a push nor a pop — it is handled separately, and getting that
 * wrong would rebuild the stack under the user for a rename.
 */
export function diffNavStack(current: NavScreen[], next: NavScreen[]): NavStackDiff {
  let shared = 0;
  while (shared < current.length && shared < next.length && current[shared].id === next[shared].id) {
    shared += 1;
  }
  return {
    pops: current.length - shared,
    pushes: next.slice(shared),
  };
}

/**
 * A pop the SYSTEM performed, applied to the store's shape.
 *
 * The gesture is the user's, so the store learns about it afterwards: given
 * the screen now on top, this says what the store should hold. Returns null
 * when the id is not in the stack at all, which means the two have drifted and
 * the caller should re-derive rather than guess.
 */
export function storeStateForScreen(
  screens: NavScreen[],
  screenId: string,
): { folderDepth: number; docTrail: number; closesDoc: boolean } | null {
  const index = screens.findIndex((s) => s.id === screenId);
  if (index < 0) return null;
  const above = screens.slice(0, index + 1);
  const folders = above.filter((s) => s.id !== "" && s.id !== "home-editor" && !s.id.startsWith("doc:"));
  const docs = above.filter((s) => s.id.startsWith("doc:"));
  return {
    folderDepth: folders.length,
    // The trail is everything below the document now on top.
    docTrail: Math.max(0, docs.length - 1),
    closesDoc: docs.length === 0,
  };
}
