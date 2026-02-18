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
