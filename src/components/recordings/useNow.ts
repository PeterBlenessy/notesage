import { useEffect, useState } from "react";

/**
 * The current time, re-read every `intervalMs` while `active`. For the
 * elapsed / remaining line of a running job: mounted in the leaf that shows
 * it, and idle (no timer at all) when nothing is running.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}
