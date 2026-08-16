/**
 * Feature flags — the single binary's replacement for the alpha channel
 * (PRD `docs/prds/2026-08-15-single-binary-feature-flags.md`).
 *
 * "Alpha" used to mean two unrelated things at once: which binary you
 * received, and what was turned on inside it. Everyone now gets the same
 * build; experimental behaviour ships in it, off, and is opted into here.
 *
 * The registry is the join key for everything else — the Labs panel row, the
 * telemetry props, the crash-report tag, and the graduation decision all
 * address a flag by the same id. Adding a flag means adding an entry here;
 * `FlagId` derives from it, so a typo at a call site is a type error rather
 * than a silently-never-enabled feature.
 */

/** How finished a flagged feature is. Shown as a badge in the Labs panel. */
export type FlagStage = "experimental" | "beta";

export interface FlagSpec {
  /** `experimental` — may change or vanish. `beta` — close to graduating. */
  stage: FlagStage;
  /** One line, user-facing. This is the Labs panel's description. */
  summary: string;
  /** App version the flag was introduced in — the clock for the graduation
   *  review (three releases without enough signal → explicit decision). */
  introducedIn: string;
  /**
   * ALWAYS `false`. Typed as the literal so the compiler refuses a flag that
   * ships on: this is what replaces the old channel-isolation guarantee
   * ("stable users never receive alpha builds") with "users never get
   * unfinished behaviour unless they opt in". `flags.test.ts` locks it too,
   * belt and braces, because the failure is silent and reaches everyone.
   */
  default: false;
}

/**
 * The live registry. Empty is a valid state — it means nothing experimental
 * is in flight, which is the goal between features rather than a gap.
 */
export const FLAGS = {
  "transcription-autodetect-language": {
    stage: "experimental",
    summary: "Detect the spoken language automatically",
    introducedIn: "0.49.0",
    default: false,
  },
} as const satisfies Record<string, FlagSpec>;

export type FlagId = keyof typeof FLAGS;

/** Ids as an array, for the Labs panel and the graduation review. */
export function flagIds(): FlagId[] {
  return Object.keys(FLAGS) as FlagId[];
}

export function flagSpec(id: FlagId): FlagSpec {
  return FLAGS[id];
}

/**
 * Registry entries for iteration — the Labs panel's rows, and the audit that
 * locks defaults off.
 *
 * Typed as `[string, FlagSpec][]` rather than `[FlagId, …]` on purpose: with
 * an EMPTY registry `FlagId` is `never`, and every iteration over it would
 * fail to typecheck. An empty registry is a valid, desirable state — it means
 * nothing experimental is in flight — so iteration must survive it.
 */
export function flagEntries(): Array<[string, FlagSpec]> {
  return Object.entries(FLAGS as Record<string, FlagSpec>);
}

/** Is `id` still in the registry? Persisted state is filtered through this,
 *  so a removed flag cannot resurrect from an old settings blob. */
export function isKnownFlag(id: string): id is FlagId {
  return Object.prototype.hasOwnProperty.call(FLAGS, id);
}
