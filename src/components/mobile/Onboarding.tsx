import { useState } from "react";
import { FolderOpen, ShieldCheck, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMobileStore } from "@/stores/mobile-store";

/**
 * First-run / re-grant screen. Explains that iOS requires a one-time permission
 * to read the iCloud `Notesage` folder and that the app only *adds* capture
 * notes. The picker is pre-pointed at `iCloud Drive/Notesage`, so granting is a
 * confirm tap, not a folder hunt (PRD task #12).
 */
export function Onboarding() {
  const grantState = useMobileStore((s) => s.grantState);
  const pickFolder = useMobileStore((s) => s.pickFolder);
  const [busy, setBusy] = useState(false);

  const isStale = grantState === "stale";

  const handleGrant = async () => {
    setBusy(true);
    try {
      await pickFolder();
    } catch (err) {
      toast.error(`Couldn't get access: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <BookOpen strokeWidth={1.5} className="h-8 w-8 text-foreground" />
      </div>

      <h1 className="mt-6 text-xl font-semibold text-foreground">
        {isStale ? "Reconnect your library" : "Welcome to Notesage"}
      </h1>

      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {isStale
          ? "Your access to the Notesage folder expired. Grant it once more to keep reading."
          : "Read your Notesage notes on the go. iOS needs a one-time permission to open your iCloud Notesage folder."}
      </p>

      <div className="mt-6 w-full max-w-sm space-y-3 text-left">
        <Feature icon={ShieldCheck} title="Read-only & private">
          The app only reads the folder you grant — the single exception is the
          notes it adds when you share a link.
        </Feature>
        <Feature icon={FolderOpen} title="Your iCloud Notesage folder">
          We open the picker right at it — just confirm the highlighted folder.
        </Feature>
      </div>

      <Button
        size="lg"
        className="mt-8 w-full max-w-sm"
        onClick={handleGrant}
        disabled={busy}
      >
        {busy ? "Opening…" : isStale ? "Reconnect folder" : "Grant access"}
      </Button>
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
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
