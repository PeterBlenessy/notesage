import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { t } from "@/lib/i18n";
import { log } from "@/lib/logger";

interface DialogCrashNoticeProps {
  name: string;
  error: Error;
  reset: () => void;
}

/**
 * What a crashed dialog renders: nothing, plus one toast. A dialog has no
 * place in the layout to put an inline fallback — it is a sibling of the
 * workspace — so the report goes to a toast with a way to try again.
 */
function DialogCrashNotice({ name, error, reset }: DialogCrashNoticeProps) {
  useEffect(() => {
    log.error("ui", `${name} dialog crashed`, error);
    toast.error(t("toast.dialogCrashed", { name }), {
      id: `dialog-crashed:${name}`,
      description: error.message,
      action: { label: t("toast.dialogCrashedRetry"), onClick: reset },
    });
  }, [name, error, reset]);
  return null;
}

interface DialogErrorBoundaryProps {
  /** Shown in the toast: "Settings", "Keyboard shortcuts", … */
  name: string;
  children: ReactNode;
}

/**
 * Error boundary for a dialog mounted at the App root.
 *
 * Those dialogs sit outside the workspace's boundary, so a render error in
 * one of them (or a lazy chunk that fails to load) used to unmount the whole
 * React tree — taking the editor and any unsaved text with it. With this,
 * only the dialog goes; the document underneath is untouched.
 */
export function DialogErrorBoundary({ name, children }: DialogErrorBoundaryProps) {
  return (
    <ErrorBoundary
      name={name}
      fallback={(error, reset) => <DialogCrashNotice name={name} error={error} reset={reset} />}
    >
      {children}
    </ErrorBoundary>
  );
}
