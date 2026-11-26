import { Loader2, Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { sameName } from "@/lib/speakers/display-names";
import type { NameSuggestion } from "@/lib/speakers/suggestions";
import { formatRecordingLength } from "@/lib/transcription/segments";

export interface SpeakerRowProps {
  /** Position in the list, for unique element ids. */
  index: number;
  /** What the voice is called until named: "Speaker 2", "Me". */
  displayName: string;
  /** Total speaking time in seconds. */
  totalSecs: number;
  value: string;
  /** The name was carried over from an earlier naming of this recording. */
  kept: boolean;
  onValueChange: (value: string) => void;
  suggestions: readonly NameSuggestion[];
  /** A chip was clicked: the ONLY way a suggestion reaches the name field. */
  onPick: (suggestion: NameSuggestion) => void;
  sample: "idle" | "loading" | "playing" | "unavailable";
  onToggleSample: () => void;
  /** Absent when voices are not remembered: there is then no checkbox at all. */
  remember?: {
    checked: boolean;
    /** Why the box cannot be ticked, when it cannot. */
    disabledReason: string | null;
    onChange: (checked: boolean) => void;
  };
}

function chipText(suggestion: NameSuggestion): string {
  switch (suggestion.source) {
    case "voice-likely":
      return t("speakers.likely", { name: suggestion.name });
    case "voice-possible":
      return t("speakers.possibly", { name: suggestion.name });
    default:
      return suggestion.name;
  }
}

function chipReason(suggestion: NameSuggestion): string {
  switch (suggestion.source) {
    case "voice-likely":
    case "voice-possible":
      return t("speakers.reasonVoice");
    case "transcript":
      return t("speakers.reasonTranscript");
    default:
      return t("speakers.reasonParticipant");
  }
}

/**
 * One voice the analysis found: hear a sample of it, see how long it spoke,
 * and say who it is.
 *
 * Suggestions are chips BELOW the name field. They never fill the field by
 * themselves: a voice match is a guess about a person, and the user is the
 * one who says who somebody is.
 */
export function SpeakerRow({
  index,
  displayName,
  totalSecs,
  value,
  kept,
  onValueChange,
  suggestions,
  onPick,
  sample,
  onToggleSample,
  remember,
}: SpeakerRowProps) {
  const inputId = `identify-speaker-name-${index}`;
  const rememberId = `identify-speaker-remember-${index}`;
  const length = formatRecordingLength(totalSecs);
  const playing = sample === "playing";

  return (
    <li className="rounded-md border border-border px-3 py-2.5" data-testid="speaker-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="h-8 w-8 shrink-0"
          aria-pressed={playing}
          disabled={sample === "unavailable" || sample === "loading"}
          aria-label={
            sample === "unavailable"
              ? t("speakers.noSampleOf", { speaker: displayName })
              : playing
                ? t("speakers.stopSampleOf", { speaker: displayName })
                : t("speakers.playSampleOf", { speaker: displayName })
          }
          onClick={onToggleSample}
          data-testid="speaker-sample"
        >
          {sample === "loading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={1.5} aria-hidden="true" />
          ) : playing ? (
            <Square className="h-3 w-3 fill-current" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Play className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          )}
        </Button>

        <div className="min-w-0 flex-1 basis-32">
          <Label htmlFor={inputId} className="block truncate text-sm font-medium" title={displayName}>
            {displayName}
          </Label>
          <p className="text-xs text-muted-foreground tabular-nums">
            {length ? t("speakers.spokeFor", { time: length }) : t("speakers.spokeBriefly")}
            {kept && <span data-testid="speaker-kept"> · {t("speakers.keptFromBefore")}</span>}
          </p>
        </div>

        <Input
          id={inputId}
          value={value}
          maxLength={120}
          placeholder={t("speakers.namePlaceholder")}
          aria-label={t("recordings.speakerNameFor", { name: displayName })}
          className="h-8 min-w-0 flex-1 basis-48"
          onChange={(event) => onValueChange(event.target.value)}
        />
      </div>

      {suggestions.length > 0 && (
        <div
          role="group"
          aria-label={t("speakers.suggestionsFor", { speaker: displayName })}
          className="mt-2 flex flex-wrap items-center gap-1.5"
        >
          <span className="text-[11px] text-muted-foreground">{t("speakers.suggestions")}</span>
          {suggestions.map((suggestion) => {
            const chosen = sameName(value, suggestion.name);
            return (
              <button
                key={`${suggestion.source}:${suggestion.name}`}
                type="button"
                aria-pressed={chosen}
                aria-label={t("speakers.useNameFor", {
                  name: suggestion.name,
                  speaker: displayName,
                  reason: chipReason(suggestion),
                })}
                title={chipReason(suggestion)}
                onClick={() => onPick(suggestion)}
                data-testid="speaker-suggestion"
                data-source={suggestion.source}
                className={
                  "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                  (chosen
                    ? "border-foreground/40 bg-muted text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground")
                }
              >
                <span className="truncate">{chipText(suggestion)}</span>
                {suggestion.source === "transcript" && (
                  <span className="shrink-0 text-[10px] opacity-80">· {t("speakers.fromTranscript")}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {remember && (
        <div className="mt-2 flex items-start gap-2">
          <Checkbox
            id={rememberId}
            checked={remember.checked && remember.disabledReason === null}
            disabled={remember.disabledReason !== null}
            onCheckedChange={(state) => remember.onChange(state === true)}
            aria-describedby={remember.disabledReason ? `${rememberId}-why` : undefined}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <Label htmlFor={rememberId} className="text-xs font-normal leading-4">
              {t("speakers.rememberThisVoice")}
            </Label>
            {remember.disabledReason && (
              <p id={`${rememberId}-why`} className="mt-0.5 text-[11px] text-muted-foreground">
                {remember.disabledReason}
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
