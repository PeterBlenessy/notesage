import { useCallback } from "react";

import {
  chooseSpeechVoice,
  cycleSpeechRate,
  pauseSpeech,
  resumeSpeech,
  skipSpeech,
  startSpeech,
  stopSpeech,
} from "@/lib/speech-controller";
import { useMobileStore } from "@/stores/mobile-store";

export { SPEECH_RATES } from "@/lib/speech-controller";

export interface SpeechPlayerState {
  /** True while THIS document is the one being read. */
  active: boolean;
  playing: boolean;
  /** Paragraph index currently being spoken. */
  index: number;
  /** Total paragraphs, or 0 before the first progress event. */
  total: number;
  rate: number;
  /** Language subtag the article is being read in ("en"), once known. */
  language: string | null;
}

const IDLE: SpeechPlayerState = {
  active: false,
  playing: false,
  index: 0,
  total: 0,
  rate: 1.0,
  language: null,
};

/**
 * The Reader's view of the app-wide read-aloud session (#833) for one
 * document: its transport state when this document is the one playing, idle
 * otherwise. Playback itself lives in `speech-controller` and the store, so
 * it neither starts nor stops with this hook — leaving the article keeps the
 * audio going, and coming back finds the transport where it was.
 */
export function useSpeechPlayer(relPath: string) {
  const session = useMobileStore((s) => s.speech);
  const speechRate = useMobileStore((s) => s.speechRate);
  const mine = session !== null && session.relPath === relPath;
  const state: SpeechPlayerState = mine
    ? {
        active: true,
        playing: session.playing,
        index: session.index,
        total: session.total,
        rate: session.rate,
        language: session.language,
      }
    : { ...IDLE, rate: speechRate };

  const start = useCallback(
    (text: string, title: string, artworkBase64?: string) => {
      if (!text.trim()) return;
      void startSpeech({ relPath, name: relPath, text, title, artworkBase64 });
    },
    [relPath],
  );

  return {
    state,
    start,
    pause: pauseSpeech,
    resume: resumeSpeech,
    stop: stopSpeech,
    skip: skipSpeech,
    cycleRate: cycleSpeechRate,
    chooseVoice: chooseSpeechVoice,
  };
}
