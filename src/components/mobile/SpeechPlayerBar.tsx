import { Island } from "./Chrome";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";
import type { SpeechPlayerState } from "@/hooks/useSpeechPlayer";

/**
 * Transport controls for reading an article aloud (#833).
 *
 * A bottom-centre island rather than a docked bar: the reader's content runs
 * edge to edge and the article is what the user came for, so the player sits
 * over it in the same quiet glass surface every other mobile affordance uses
 * and never reflows the text.
 *
 * The controls are the ones that matter while walking — play/pause big enough
 * to hit without looking, skip a paragraph either way, and speed. Everything
 * else (voice choice, scrubbing) is deliberately absent; the same controls
 * exist on the lock screen, which is where they will mostly be used.
 */
export function SpeechPlayerBar({
  state,
  onPlayPause,
  onSkip,
  onCycleRate,
  onStop,
}: {
  state: SpeechPlayerState;
  onPlayPause: () => void;
  onSkip: (delta: number) => void;
  onCycleRate: () => void;
  onStop: () => void;
}) {
  useLocale();

  if (!state.active) return null;

  const position =
    state.total > 0 ? `${Math.min(state.index + 1, state.total)} / ${state.total}` : "…";

  return (
    <Island corner="bottom-center">
      <div
        className="flex items-center gap-1 px-1"
        role="group"
        aria-label={t("reader.listenPlayer")}
      >
        <PlayerButton
          label={t("reader.listenBack")}
          onClick={() => onSkip(-1)}
          // A back-skip re-speaks the current paragraph from its start when
          // already at the first one, which is what a listener expects from
          // "back" — so it is never disabled.
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="currentColor">
            <path d="M9 4 3 10l6 6V4Zm8 0-6 6 6 6V4Z" />
          </svg>
        </PlayerButton>

        <PlayerButton
          label={state.playing ? t("reader.listenPause") : t("reader.listenResume")}
          onClick={onPlayPause}
          wide
        >
          {state.playing ? (
            <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true" fill="currentColor">
              <path d="M6 4h3v12H6V4Zm5 0h3v12h-3V4Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true" fill="currentColor">
              <path d="M6 4l10 6-10 6V4Z" />
            </svg>
          )}
        </PlayerButton>

        <PlayerButton label={t("reader.listenForward")} onClick={() => onSkip(1)}>
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="currentColor">
            <path d="M11 4l6 6-6 6V4Zm-8 0 6 6-6 6V4Z" />
          </svg>
        </PlayerButton>

        {/* Position is spoken as paragraphs, not minutes: the synthesiser
            gives no reliable duration up front, and a wrong clock is worse
            than an honest count. */}
        <span
          className="min-w-[3.5rem] px-1 text-center text-xs tabular-nums text-muted-foreground"
          aria-live="off"
        >
          {position}
        </span>

        <PlayerButton label={t("reader.listenSpeed", { rate: state.rate })} onClick={onCycleRate}>
          <span className="text-xs font-medium tabular-nums">{state.rate}×</span>
        </PlayerButton>

        <PlayerButton label={t("reader.listenStop")} onClick={onStop}>
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="currentColor">
            <path d="M5 5h10v10H5V5Z" />
          </svg>
        </PlayerButton>
      </div>
    </Island>
  );
}

function PlayerButton({
  label,
  onClick,
  wide,
  children,
}: {
  label: string;
  onClick: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      // 44pt minimum touch target — this is used one-handed while walking,
      // which is the case the whole feature exists for.
      className={`flex min-h-11 items-center justify-center rounded-full text-foreground transition-colors active:bg-muted ${
        wide ? "min-w-12" : "min-w-11"
      }`}
    >
      {children}
    </button>
  );
}
