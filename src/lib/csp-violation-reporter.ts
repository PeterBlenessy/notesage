import { log } from '@/lib/logger';

/**
 * Report CSP violations to the log, with enough detail to act on them.
 *
 * Three stylesheet violations fire on every launch and have been carried in
 * `docs/performance-baseline.md` since v0.59.0 without anyone knowing which
 * stylesheets they are. They cannot be reproduced in development: `tauri dev`
 * serves the app over Vite with no CSP header at all, which is the same gap
 * that hid #444 (see `commands/html_preview.rs`). So the only way to identify
 * them is to have the shipped build say so.
 *
 * The cause of the class is known even where the instances are not. The
 * configured policy allows `style-src 'self' 'unsafe-inline'`, but Tauri
 * rewrites it at runtime with a nonce — and per the CSP spec a nonce makes
 * `'unsafe-inline'` inert. Any stylesheet that arrives without the nonce is
 * therefore refused, whatever the config appears to permit.
 *
 * The browser's own console message names none of this, which is why it went
 * three releases unexamined: "its hash, its nonce, or 'unsafe-inline' does not
 * appear in the style-src directive" is the same string regardless of which
 * stylesheet was blocked or who injected it.
 */
export function reportCspViolations(): void {
  if (typeof document === 'undefined') return;

  document.addEventListener('securitypolicyviolation', (event) => {
    log.warn('csp', 'Blocked by Content-Security-Policy', {
      // What was refused, and under which rule.
      violatedDirective: event.violatedDirective,
      effectiveDirective: event.effectiveDirective,
      blockedURI: event.blockedURI,
      disposition: event.disposition,
      // Where it came from. `sourceFile` is the one that matters: for an
      // injected <style> it points at the code that injected it, which a
      // console message never does.
      sourceFile: event.sourceFile,
      lineNumber: event.lineNumber,
      columnNumber: event.columnNumber,
      // The first stretch of the offending content, for an inline block that
      // has no URI to name. Capped: a stylesheet can be very large, and this
      // goes to a log file the user may share.
      sample: event.sample ? event.sample.slice(0, 120) : undefined,
      // What the policy actually was at runtime — the nonce rewrite means this
      // differs from tauri.conf.json, and that difference is the whole story.
      policy: event.originalPolicy?.slice(0, 400),
    });
  });
}
