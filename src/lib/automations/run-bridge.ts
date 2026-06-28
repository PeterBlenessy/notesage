// Bridge so non-runner surfaces (the "Run now" button in the form builder, the
// missed-runs chooser) can ask the always-mounted runner to execute an
// automation by path — without importing React hook state. Mirrors the
// focus-mode-controller bridge pattern.
//
// PRD: docs/prds/2026-06-28-automations.md (Task #7)

type RunNow = (sourcePath: string) => void;

let runNowImpl: RunNow | null = null;

/** Registered once by `useAutomationRunner`. Returns an unregister fn. */
export function registerAutomationRunner(fn: RunNow): () => void {
  runNowImpl = fn;
  return () => {
    if (runNowImpl === fn) runNowImpl = null;
  };
}

/** Request an immediate run of the automation at `sourcePath` (no-op if the
 *  runner isn't mounted yet). */
export function runAutomationNow(sourcePath: string): void {
  runNowImpl?.(sourcePath);
}
