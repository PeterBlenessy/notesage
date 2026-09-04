import { Headphones, Pause, Play } from "lucide-react";
import { t } from "@/lib/i18n";
import { toggleSpeech } from "@/lib/speech-controller";
import type { FileEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useMobileStore } from "@/stores/mobile-store";

/**
 * The read-aloud control on a list row or a gallery card (#833, list
 * playback): headphones to start, then Pause / Play for the document that is
 * playing, with a ring around the edge filling as the article is read.
 *
 * One gesture, no transport: skipping, speed and stop live in the Reader —
 * from the list you start, pause and resume. Playback continues when the
 * article is opened, and this shows again, mid-ring, when the user comes
 * back to the list.
 */
export function ListenButton({
  entry,
  size,
  className,
}: {
  entry: Pick<FileEntry, "path" | "name">;
  /** `row`: a 32pt muted disc at the row's edge. `card`: a 28pt badge on
   *  the thumbnail. */
  size: "row" | "card";
  className?: string;
}) {
  const session = useMobileStore((s) => (s.speech?.relPath === entry.path ? s.speech : null));
  const playing = session?.playing ?? false;
  // Counts the paragraph being read, like the Reader's "4 / 12": both
  // surfaces show at once, so they must agree.
  const fraction = session && session.total > 0 ? Math.min(1, (session.index + 1) / session.total) : 0;
  const label = session ? (playing ? t("reader.listenPause") : t("reader.listenResume")) : t("action.listen");
  const Icon = session ? (playing ? Pause : Play) : Headphones;
  const px = size === "row" ? 32 : 28;
  const stroke = 2;
  const r = (px - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={session ? playing : undefined}
      data-testid={size === "row" ? "row-listen" : "card-listen"}
      data-state={session ? (playing ? "playing" : "paused") : "idle"}
      onClick={() => toggleSpeech(entry)}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full",
        size === "row"
          ? "bg-muted text-muted-foreground hover:text-foreground"
          : "bg-background/85 text-foreground shadow-sm backdrop-blur",
        session && "text-foreground",
        className,
      )}
      style={{ width: px, height: px }}
    >
      {session && (
        // The ring: a faint full circle under a bright arc for the part
        // already read, drawn from twelve o'clock.
        <svg
          className="pointer-events-none absolute inset-0"
          viewBox={`0 0 ${px} ${px}`}
          aria-hidden="true"
        >
          <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={stroke} />
          <circle
            cx={px / 2}
            cy={px / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            transform={`rotate(-90 ${px / 2} ${px / 2})`}
            data-testid="listen-ring"
          />
        </svg>
      )}
      <Icon
        className={size === "row" ? "h-4 w-4" : "h-3.5 w-3.5"}
        strokeWidth={1.5}
        fill={session ? "currentColor" : "none"}
        aria-hidden="true"
      />
    </button>
  );
}
