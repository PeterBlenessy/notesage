export { AISuggestion, setSuggestion, clearSuggestion, hasActiveSuggestion } from './ai-suggestion';
export type { AISuggestion as AISuggestionType } from './ai-suggestion';
export {
  InlineDiff,
  showInlineDiff,
  clearInlineDiff,
  acceptDiffHunk,
  rejectDiffHunk,
  acceptAllDiffHunks,
  rejectAllDiffHunks,
  hasActiveInlineDiff,
  getInlineDiffHunks,
} from './inline-diff';
export type { InlineDiffHunk } from './inline-diff';
export {
  CommentMark,
  setCommentDecorations,
  clearCommentDecorations,
  setActiveCommentDecoration,
  setPendingCommentRange,
  getCommentAtPos,
  getCommentMarkState,
  CommentMarkPluginKey,
} from './comment-mark';
export { LocalImage } from './local-image';
export { pageBreaksKey } from './page-breaks';
export {
  GhostText,
  GhostTextPluginKey,
  setGhostText,
  clearGhostText,
  acceptGhostText,
  hasActiveGhostText,
} from './ghost-text';
export type { GhostTextCompletion } from './ghost-text';
export { TagHighlight } from './tag-highlight';
export { TagSuggestion } from './tag-suggestion';
export {
  SearchHighlight,
  SearchPluginKey,
  setSearchQuery,
  searchNext,
  searchPrevious,
  clearSearch,
  replaceCurrentMatch,
  replaceAllMatches,
  getSearchState,
} from './search-highlight';
export { DragHandle, DragHandlePluginKey } from './drag-handle';
export {
  ItemAnnotation,
  ItemAnnotationPluginKey,
  setItemAnnotation,
  serializeAnnotation,
} from './item-annotation';
export type { AnnotationClickDetail } from './item-annotation';
