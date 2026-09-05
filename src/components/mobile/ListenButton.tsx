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
  /** `row`: a 36pt glass disc FLOATING over the row's right edge — it
   *  reserves no column, so the title and excerpt keep the full width and
   *  simply pass behind it, blurred (Peter, 2026-09-05). `card`: a 28pt
   *  badge on a gallery thumbnail. */
  size: "row" | "card";
  className?: string;
}) {
  const session = useMobileStore((s) => (s.speech?.relPath === entry.path ? s.speech : null));
  // One owner of the audio session: no listening while a recording runs.
  const recording = useMobileStore((s) => s.recording.status !== "idle");
  const playing = session?.playing ?? false;
  // Counts the paragraph being read, like the Reader's "4 / 12": both
  // surfaces show at once, so they must agree.
  const fraction = session && session.total > 0 ? Math.min(1, (session.index + 1) / session.total) : 0;
  const label = session ? (playing ? t("reader.listenPause") : t("reader.listenResume")) : t("action.listen");
  const Icon = session ? (playing ? Pause : Play) : Headphones;
  const px = size === "row" ? 36 : 28;
  const stroke = 2;
  const r = (px - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  // The row's control FLOATS: it is positioned by the row, over the content,
  // and takes no width from it.
  //
  // It used to be a 72pt column, which is a third of the text's width on a
  // 393pt screen — so titles that had fitted on one line wrapped onto two,
  // and rows grew to 107-136pt against a 72pt thumbnail (Peter, device,
  // build 50; measured off the screenshot). Reserving nothing gives the
  // title and excerpt that width back. What the disc covers, it covers as
  // glass: translucent over a backdrop blur, so the words behind it stay
  // visibly words rather than disappearing under a plate.
  //
  // The hit area stays a thumb's worth — 44pt, Apple's minimum — around a
  // 36pt disc, through padding rather than through layout.
  return (
    <button
      type="button"
      aria-label={recording ? t("recording.inProgress") : label}
      disabled={recording}
      aria-pressed={session ? playing : undefined}
      data-testid={size === "row" ? "row-listen" : "card-listen"}
      data-state={session ? (playing ? "playing" : "paused") : "idle"}
      onClick={() => toggleSpeech(entry)}
      className={cn(
        // The column is the hit area; the DISC is what presses (Peter,
        // 2026-09-04: the whole block lit up). No `ios-press-row` here — its
        // :active fill is the block flash — only its no-select/no-callout
        // half, and the press state handed to the disc through `group`.
        "group flex shrink-0 select-none items-center justify-center [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]",
        size === "row" ? "h-11 w-11 rounded-full" : "rounded-full",
        className,
      )}
      style={size === "card" ? { width: px, height: px } : undefined}
    >
    <span
      className={cn(
        "relative flex items-center justify-center rounded-full transition-colors duration-150",
        size === "row"
          // Glass, not a plate: what passes behind stays legible as words.
          ? "bg-background/55 text-foreground shadow-sm backdrop-blur-md group-active:bg-foreground/20"
          : "bg-background/85 text-foreground shadow-sm backdrop-blur group-active:bg-foreground/20",
        session && "text-foreground",
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
        className={size === "row" ? "h-[18px] w-[18px]" : "h-3.5 w-3.5"}
        strokeWidth={1.5}
        fill={session ? "currentColor" : "none"}
        aria-hidden="true"
      />
    </span>
    </button>
  );
}
