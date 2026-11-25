import { getFormatLocale, t } from "@/lib/i18n";
import { GLOBAL_SCOPE, type IndexingSummary } from "@/lib/index-progress";

/** How many scope names the detail line spells out before it stops. */
const MAX_NAMED_SCOPES = 2;

function formatCount(value: number): string {
  return new Intl.NumberFormat(getFormatLocale(), { useGrouping: true }).format(value);
}

/** What a scope is called: the project's folder name, or "Library". */
export function indexScopeName(key: string): string {
  if (key === GLOBAL_SCOPE) return t("indexing.scopeLibrary");
  const name = key.split(/[\\/]/).filter(Boolean).pop();
  return name ?? key;
}

/**
 * The one sentence every indexing surface shows: "Indexing your library,
 * 1,200 of 3,000 files", or without numbers while no pass has reported any.
 */
export function indexingLabel(status: IndexingSummary): string {
  if (status.filesTotal <= 0) return t("indexing.starting");
  return t("indexing.progress", {
    done: formatCount(status.filesDone),
    total: formatCount(status.filesTotal),
  });
}

/**
 * The breakdown under the sentence: which scopes are being indexed right now
 * and how many projects have not started. `null` when there is nothing to add.
 */
export function indexingDetail(status: IndexingSummary): string | null {
  const parts: string[] = [];
  if (status.currentScopes.length > 0) {
    const named = status.currentScopes.slice(0, MAX_NAMED_SCOPES).map(indexScopeName);
    const more = status.currentScopes.length - named.length;
    parts.push(t("indexing.now", { names: named.join(", ") + (more > 0 ? ` +${more}` : "") }));
  }
  if (status.pendingScopes > 0) {
    parts.push(t("indexing.pendingProjects", { count: status.pendingScopes }));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
