import { useCallback, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { iosListDirectory } from "@/lib/ios-api";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";
import { defaultHomeFolders } from "@/lib/home-file";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";
import type { FileEntry } from "@/lib/tauri";
import { useMobileStore } from "@/stores/mobile-store";
import { ChromeButton, CONTENT_INSETS, Island } from "./Chrome";
import { useFolderAppearance } from "./useFolderAppearance";
import { a11yRootProps, useA11yPrefs, useNativeChrome } from "./useNativeChrome";
import { BrowserError, BrowserSkeleton } from "./BrowserStates";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: FileEntry[] };

/**
 * Edit Home: every root folder with a switch, the Inbox first.
 *
 * The app has no settings screen — every preference is a UIMenu row — but a
 * list of thirty folders is a screen's worth, and iOS has the precedent
 * (Files → Browse → Edit is a toggle list of locations). A toggle writes at
 * once; there is no Save. Web-rendered with the native back/title chrome,
 * so no Swift.
 */
export function HomeFolders() {
  const a11y = useA11yPrefs();
  useLocale();
  const homeFolders = useMobileStore((s) => s.homeFolders);
  const setOnHome = useMobileStore((s) => s.setOnHome);
  const closeHomeEditor = useMobileStore((s) => s.closeHomeEditor);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // The switch flips at once and reverts if the write fails — a toggle that
  // waits for iCloud reads as broken.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const entries = await iosListDirectory("");
      const dirs = entries
        .filter((e) => e.is_directory && !e.hidden && !e.name.startsWith("."))
        .sort((a, b) => {
          if (a.name === INBOX_FOLDER_NAME) return -1;
          if (b.name === INBOX_FOLDER_NAME) return 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });
      setState({ status: "ready", entries: dirs });
    } catch (err) {
      setState({ status: "error", message: String(err) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const nativeChrome = useNativeChrome(
    {
      topLeft: { id: "back", icon: "chevron.backward" },
      topCenter: { title: t("home.editTitle") },
    },
    { back: () => closeHomeEditor() },
  );

  const entries = state.status === "ready" ? state.entries : [];
  const chosen = new Set(homeFolders ?? defaultHomeFolders(entries));
  const isOn = (path: string) => pending[path] ?? chosen.has(path);
  const toggle = (path: string, next: boolean) => {
    setPending((p) => ({ ...p, [path]: next }));
    void setOnHome(path, next, entries)
      .catch((err) => toast.error(t("home.updateFailed", { error: String(err) })))
      .finally(() =>
        setPending((p) => {
          const { [path]: _done, ...rest } = p;
          return rest;
        }),
      );
  };

  return (
    <div className="relative h-full w-full bg-background" {...a11yRootProps(a11y)}>
      <div className="absolute inset-0 overflow-y-auto" style={CONTENT_INSETS}>
        {!nativeChrome && (
          <div className="px-4 pb-1 pt-2">
            <h1 className="truncate text-[length:calc(1.5rem*var(--ns-a11y-scale,1))] font-bold text-foreground">
              {t("home.editTitle")}
            </h1>
          </div>
        )}
        {state.status === "loading" && <BrowserSkeleton />}
        {state.status === "error" && <BrowserError message={state.message} onRetry={() => void load()} />}
        {state.status === "ready" && (
          <ul aria-label={t("home.editTitle")}>
            {entries.map((entry) => (
              <HomeFolderRow key={entry.path} entry={entry} on={isOn(entry.path)} onToggle={(next) => toggle(entry.path, next)} />
            ))}
          </ul>
        )}
      </div>
      {!nativeChrome && (
        <Island corner="top-left">
          <ChromeButton label={t("reader.back")} onClick={() => closeHomeEditor()}>
            <ChevronLeft strokeWidth={1.5} className="h-4 w-4" />
          </ChromeButton>
        </Island>
      )}
    </div>
  );
}

function HomeFolderRow({ entry, on, onToggle }: { entry: FileEntry; on: boolean; onToggle: (next: boolean) => void }) {
  const folder = useFolderAppearance(entry);
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center">
        <folder.Icon strokeWidth={1.5} className="h-5 w-5 shrink-0 text-muted-foreground" style={{ color: folder.color }} />
      </span>
      <span
        className="min-w-0 flex-1 truncate text-[length:calc(1.0625rem*var(--ns-a11y-scale,1))] text-foreground"
        style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
      >
        {entry.name}
      </span>
      <Switch checked={on} onCheckedChange={onToggle} aria-label={entry.name} />
    </li>
  );
}
