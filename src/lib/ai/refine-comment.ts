import type { RefinementResult, RefinementEntryStatus } from './refinement';
import { isRefinementResult } from './refinement';

/**
 * HTML-comment codec for ambient action refinements.
 *
 * A refinement is persisted on the source line as a trailing HTML comment so it
 * survives the markdown round-trip and re-populates on reopen. The comment
 * encodes the {@link RefinementResult} plus the source-line content hash (the
 * "watermark"). When the visible line text no longer hashes to the stored hash,
 * the line was edited and must be re-analyzed.
 *
 * See `docs/prds/2026-06-13-ambient-action-refinement.md`.
 *
 * Wire format: `<!-- ns-refine:v1 <base64> -->` where `<base64>` is the
 * base64-encoded UTF-8 JSON of `{ v: 1, src, status, result }`. Base64 keeps the
 * comment body in the `[A-Za-z0-9+/=]` charset, so `-->`, quotes, or any other
 * tricky characters inside `outcome`/`rationale` can never break the comment.
 */

const MARKER = 'ns-refine:v1';

/** Matches an `ns-refine:v1` comment anywhere in a line; captures the base64 payload. */
const COMMENT_RE = /<!--\s*ns-refine:v1\s+([A-Za-z0-9+/=]+)\s*-->/;

/** Same pattern, global + tolerant of surrounding spaces, for stripping. */
const STRIP_RE = /\s*<!--\s*ns-refine:v1\s+[A-Za-z0-9+/=]+\s*-->/g;

interface RefinePayload {
  v: 1;
  src: string;
  status: RefinementEntryStatus;
  result: RefinementResult;
}

const VALID_STATUSES: readonly RefinementEntryStatus[] = ['pending', 'applied', 'dismissed'];

/** UTF-8-safe string → base64 (browser `btoa` only handles latin1). */
function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** base64 → UTF-8 string. Throws on malformed base64 (caller catches). */
function base64ToUtf8(input: string): string {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * Serialize a refinement to a single `ns-refine:v1` HTML comment string.
 *
 * @param result  The structured refinement result.
 * @param srcHash The content hash (watermark) of the source line at refine time.
 * @param status  The entry status; defaults to `'pending'`.
 */
export function serializeRefineComment(
  result: RefinementResult,
  srcHash: string,
  status: RefinementEntryStatus = 'pending',
): string {
  const payload: RefinePayload = { v: 1, src: srcHash, status, result };
  const encoded = utf8ToBase64(JSON.stringify(payload));
  return `<!-- ${MARKER} ${encoded} -->`;
}

/**
 * Parse the first `ns-refine:v1` comment found anywhere in a line.
 *
 * Returns `null` on any missing / malformed / corrupt input — never throws.
 */
export function parseRefineComment(
  lineText: string,
): { result: RefinementResult; srcHash: string; status: RefinementEntryStatus } | null {
  const match = COMMENT_RE.exec(lineText);
  if (!match) return null;

  try {
    const json = base64ToUtf8(match[1]);
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const payload = parsed as Record<string, unknown>;
    if (payload.v !== 1) return null;
    if (typeof payload.src !== 'string') return null;
    if (typeof payload.status !== 'string' || !VALID_STATUSES.includes(payload.status as RefinementEntryStatus)) {
      return null;
    }
    if (!isRefinementResult(payload.result)) return null;

    return {
      result: payload.result,
      srcHash: payload.src,
      status: payload.status as RefinementEntryStatus,
    };
  } catch {
    return null;
  }
}

/**
 * Return `lineText` with any `ns-refine` comment (and its surrounding spaces)
 * removed. Lines without one are returned unchanged.
 */
export function stripRefineComment(lineText: string): string {
  return lineText.replace(STRIP_RE, '');
}

/**
 * True when the line carries a valid `ns-refine` comment whose stored `srcHash`
 * equals `currentHash` — i.e. the line is unchanged since it was refined. False
 * when the comment is absent, corrupt, or its hash has diverged.
 */
export function isLineRefined(lineText: string, currentHash: string): boolean {
  const parsed = parseRefineComment(lineText);
  return parsed !== null && parsed.srcHash === currentHash;
}
