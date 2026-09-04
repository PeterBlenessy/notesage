import { getFormatLocale, t } from "@/lib/i18n";

/**
 * Date buckets for the Inbox list, the phone's grouping (#652) at desk width:
 * Today · Yesterday · Previous 7 Days · one section per older month.
 *
 * Pure so it can be tested against a fixed "now". `modified` is seconds
 * since the epoch as the listing reports it; an item without one sinks to
 * the last section rather than floating to the top as "today".
 */
export interface DatedItem {
  path: string;
  modified?: number;
}

export interface InboxGroup<T extends DatedItem> {
  key: string;
  title: string;
  items: T[];
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DAY_MS = 86_400_000;

export function groupByDate<T extends DatedItem>(items: T[], now: Date = new Date()): Array<InboxGroup<T>> {
  const today = startOfDay(now);
  const yesterday = today - DAY_MS;
  const weekAgo = today - 7 * DAY_MS;

  const buckets = new Map<string, InboxGroup<T>>();
  const push = (key: string, title: string, item: T) => {
    let group = buckets.get(key);
    if (!group) {
      group = { key, title, items: [] };
      buckets.set(key, group);
    }
    group.items.push(item);
  };

  // Newest first inside every bucket; undated items keep their listing order
  // at the very end.
  const sorted = [...items].sort((a, b) => (b.modified ?? -1) - (a.modified ?? -1));
  for (const item of sorted) {
    if (item.modified === undefined) {
      push("older", t("section.older"), item);
      continue;
    }
    const at = item.modified * 1000;
    if (at >= today) push("today", t("section.today"), item);
    else if (at >= yesterday) push("yesterday", t("section.yesterday"), item);
    else if (at >= weekAgo) push("week", t("section.previous7Days"), item);
    else {
      const d = new Date(at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const sameYear = d.getFullYear() === now.getFullYear();
      const title = d.toLocaleDateString(getFormatLocale(), sameYear ? { month: "long" } : { month: "long", year: "numeric" });
      push(key, title, item);
    }
  }

  // Bucket insertion order already follows the sort (newest first), except
  // that "older" (undated) must trail everything.
  const groups = [...buckets.values()];
  const undated = groups.findIndex((g) => g.key === "older");
  if (undated >= 0 && undated !== groups.length - 1) {
    const [g] = groups.splice(undated, 1);
    groups.push(g);
  }
  return groups;
}
