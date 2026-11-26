import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRecordingStore } from '@/stores/recording-store';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';
import { pickModelForLanguage, speechLanguageOptions } from '@/lib/transcription/languages';

/** "large-v3" -> "Large V3" — mirrors `TranscriptionSettings`' model label. */
export function modelDisplayName(name: string): string {
  return name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Open Settings on the transcription page. Addressed by the section's id, not
 * its label: the label is translated and has been renamed before.
 */
export function openTranscriptionSettings(): void {
  window.dispatchEvent(new CustomEvent('notesage:open-settings', { detail: { tab: 'voice' } }));
}

export interface RerunChoice {
  model: string;
  /** Set when the user picked a language; otherwise the run keeps the one it had. */
  language?: string;
}

/**
 * The "transcribe (again) with…" menu: every downloaded Whisper model, and a
 * language submenu. Used by the transcription card in the orb and by each row
 * of the Recordings view, so the choice is the same wherever it is offered.
 *
 * The language can be changed here too. A wrong language is the more common
 * failure and the more destructive one: the model hears the words correctly
 * and writes them in another language's spelling, so the output looks like
 * confident nonsense rather than a bad transcript. Re-running with the right
 * language fixes it outright, so it belongs beside the model choice rather
 * than buried in Settings.
 *
 * With no model downloaded there is nothing to pick, and the menu says where
 * to get one instead of ending in a disabled line.
 */
export function RerunTranscriptionMenu({
  children,
  onPick,
  align = 'end',
}: {
  /** The trigger: a single element that can take a ref (a `Button`). */
  children: ReactNode;
  onPick: (choice: RerunChoice) => void;
  align?: 'start' | 'end';
}) {
  // Re-render the translated language names when the app language changes.
  useLocale();
  const models = useRecordingStore((s) => s.availableModels);
  const defaultModel = useRecordingStore((s) => s.defaultModel);
  const refreshModels = useRecordingStore((s) => s.refreshModels);
  const downloaded = models.filter((m) => m.downloaded);
  // The default may be a model that was never downloaded (it is the shipped
  // default before any download). A language pick must land on one that is.
  const preferred = downloaded.some((m) => m.name === defaultModel) ? defaultModel : (downloaded[0]?.name ?? defaultModel);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && models.length === 0) void refreshModels();
      }}
    >
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('activity.rerunWithModel')}
        </DropdownMenuLabel>
        {downloaded.length === 0 ? (
          <>
            <DropdownMenuItem disabled>{t('activity.noModelsDownloaded')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={openTranscriptionSettings}>
              {t('transcription.downloadModel')}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {downloaded.map((m) => (
              <DropdownMenuItem key={m.name} onSelect={() => onPick({ model: m.name })}>
                {modelDisplayName(m.name)}
                {m.name === defaultModel && (
                  <span className="ml-auto pl-3 text-[11px] text-muted-foreground">
                    {t('transcription.defaultModel')}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-xs">
                {t('activity.rerunInLanguage')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                {speechLanguageOptions().map((lang) => (
                  <DropdownMenuItem
                    key={lang.value}
                    onSelect={() =>
                      onPick({
                        // Not simply `defaultModel`: re-running to FIX a wrong
                        // language must not hand the job to an English-only model.
                        model: pickModelForLanguage(
                          preferred,
                          lang.value,
                          downloaded.map((m) => m.name),
                        ),
                        language: lang.value,
                      })
                    }
                  >
                    {lang.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
