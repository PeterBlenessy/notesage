import { useState } from "react";
import { FolderOpen, ShieldCheck, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMobileStore } from "@/stores/mobile-store";
import { iosOpenSettings } from "@/lib/ios-api";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";
import { useA11yPrefs, a11yRootProps } from "./useNativeChrome";

/**
 * The picker screen, in three voices (PRD 2026-09-05-icloud-container-library):
 *
 * - `icloud-unavailable` — the container could not be resolved (no iCloud
 *   account, iCloud Drive off for Notesage, a reviewer's device): explains
 *   that Notesage keeps its library in iCloud and offers a folder of the
 *   user's choosing instead, plus the way to Settings.
 * - `stale` — a chosen folder's bookmark no longer resolves: re-grant copy.
 *   With iCloud available, a second button switches to Notesage in iCloud.
 * - `ungranted` — the original welcome copy (kept for a cleared grant).
 *
 * With iCloud on, a fresh install never sees this screen at all — the
 * library is the app's own container and `MobileApp` goes straight to it.
 * The picker is pre-pointed at `iCloud Drive/Notesage`.
 */
export function Onboarding() {
  const grantState = useMobileStore((s) => s.grantState);
  const icloudAvailable = useMobileStore((s) => s.icloudAvailable);
  useLocale();
  const pickFolder = useMobileStore((s) => s.pickFolder);
  const setLibraryMode = useMobileStore((s) => s.setLibraryMode);
  const [busy, setBusy] = useState(false);
  const a11y = useA11yPrefs();

  const isStale = grantState === "stale";
  const noICloud = grantState === "icloud-unavailable";

  const handleSwitchToContainer = async () => {
    setBusy(true);
    try {
      await setLibraryMode("container");
    } catch (err) {
      toast.error(t("library.switchToICloudFailed", { error: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const handleGrant = async () => {
    setBusy(true);
    try {
      await pickFolder();
    } catch (err) {
      const message = String(err);
      // Dismissing the picker is a normal choice, not a failure.
      if (message.includes("No folder was selected")) {
        toast.info(t("onboarding.noFolder"));
      } else {
        toast.error(`Couldn't open your folder: ${err}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center px-8 text-center"
      {...a11yRootProps(a11y)}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <BookOpen strokeWidth={1.5} className="h-8 w-8 text-foreground" />
      </div>

      <h1
        className="mt-6 text-[length:calc(1.25rem*var(--ns-a11y-scale,1))] text-foreground"
        style={{ fontWeight: "max(600, var(--ns-a11y-weight, 400))" }}
      >
        {noICloud
          ? t("onboarding.titleNoICloud")
          : isStale
            ? t("onboarding.titleStale")
            : t("onboarding.title")}
      </h1>

      <p
        className="mt-3 max-w-sm text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] leading-relaxed text-muted-foreground"
        style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
      >
        {noICloud
          ? t("onboarding.introNoICloud")
          : isStale
            ? t("onboarding.introStale")
            : t("onboarding.intro")}
      </p>

      <div className="mt-6 w-full max-w-sm space-y-3 text-left">
        <Feature icon={ShieldCheck} title={t("onboarding.privateTitle")}>
          {t("onboarding.privateBody")}
        </Feature>
        <Feature icon={FolderOpen} title={t("onboarding.folderTitle")}>
          {t("onboarding.folderBody")}
        </Feature>
      </div>

      <Button
        size="lg"
        className="ios-press-row mt-8 w-full max-w-sm"
        onClick={handleGrant}
        disabled={busy}
      >
        {busy
          ? t("onboarding.opening")
          : noICloud
            ? t("onboarding.chooseFolder")
            : isStale
              ? t("onboarding.pickAgain")
              : t("onboarding.pick")}
      </Button>

      {/* The way out that is NOT the picker: to Settings when iCloud is off
          (turning it on is the intended path — the picker is the fallback),
          and to Notesage in iCloud when a chosen folder broke but iCloud is
          right there. A text button, second to the primary on purpose. */}
      {noICloud && (
        <Button
          variant="link"
          className="ios-press-row mt-2 w-full max-w-sm"
          onClick={() => void iosOpenSettings().catch(() => {})}
          disabled={busy}
        >
          {t("onboarding.howToTurnOnICloud")}
        </Button>
      )}
      {isStale && icloudAvailable && (
        <Button
          variant="link"
          className="ios-press-row mt-2 w-full max-w-sm"
          onClick={handleSwitchToContainer}
          disabled={busy}
        >
          {t("onboarding.useICloudInstead")}
        </Button>
      )}
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-border p-3">
      <Icon strokeWidth={1.5} className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div>
        <div
          className="text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-foreground"
          style={{ fontWeight: "max(500, var(--ns-a11y-weight, 400))" }}
        >
          {title}
        </div>
        <div
          className="mt-0.5 text-[length:calc(0.75rem*var(--ns-a11y-scale,1))] leading-relaxed text-muted-foreground"
          style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
