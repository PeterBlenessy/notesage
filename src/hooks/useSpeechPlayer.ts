import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  iosSpeechPause,
  iosSpeechResume,
  iosSpeechSetRate,
  iosSpeechSetVoice,
  iosSpeechSkip,
  iosSpeechStart,
  iosSpeechStop,
  onIosSpeechEvent,
} from "@/lib/ios-api";
import { useMobileStore } from "@/stores/mobile-store";

/** Speech rates offered in the player, as AVSpeechUtterance rate multipliers. */
export const SPEECH_RATES = [0.8, 1.0, 1.25, 1.5, 2.0] as const;

/**
 * `AVSpeechUtteranceDefaultSpeechRate` is 0.5, not 1.0 — the API's rate axis
 * runs 0…1 with "normal" in the middle. Multiplying a user-facing 1.5× by 0.5
 * is what makes the slider mean what it says.
 */
const AV_DEFAULT_RATE = 0.5;

export interface SpeechPlayerState {
  /** True once playback has been started for this document. */
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
 * Drive the native speech player for one document (#833).
 *
 * The native side owns playback (it has to — audio must survive backgrounding
 * and the lock screen), so this hook is a thin controller plus the position
 * bookkeeping the native side cannot do: which document a position belongs to,
 * and persisting it so a part-listened article resumes.
 */
export function useSpeechPlayer(relPath: string) {
  const [state, setState] = useState<SpeechPlayerState>(IDLE);
  const rememberSpeechPosition = useMobileStore((s) => s.rememberSpeechPosition);
  const rememberSpeechVoice = useMobileStore((s) => s.rememberSpeechVoice);

  // Read positions off the store imperatively. Subscribing would re-render the
  // reader on every paragraph boundary — the position is written far more
  // often than it is read.
  const savedIndexFor = useCallback(
    (path: string) => useMobileStore.getState().speechPositions[path] ?? 0,
    [],
  );

  // The path playback belongs to, so a progress event that arrives after the
  // reader moved on cannot write its position onto the new document.
  const playingPathRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    return onIosSpeechEvent((event) => {
      const owner = playingPathRef.current;
      if (!owner) return;
      if (event.event === "progress") {
        setState((prev) => ({ ...prev, index: event.index, total: event.total, active: true }));
        // Persist the position of whichever document is actually playing —
        // never the one currently on screen, which may already be a different
        // article by the time this fires.
        rememberSpeechPosition(owner, event.index);
        return;
      }
      if (event.event === "playing") {
        // Play/pause can come from the lock screen or Control Centre, which
        // never touch this code — without this the transport shows the wrong
        // icon and the next tap calls the wrong native method.
        setState((prev) => ({ ...prev, playing: event.playing }));
        return;
      }
      // finished: the article ended (or was stopped natively). Retire the
      // transport instead of leaving it showing Pause for something silent,
      // and start the NEXT listen from the top rather than the end.
      playingPathRef.current = null;
      rememberSpeechPosition(owner, 0);
      setState(IDLE);
    });
  }, [rememberSpeechPosition]);

  const fail = useCallback((err: unknown) => {
    // A rejection here means the native player is unavailable (desktop dev,
    // the vitest harness, an older build). Reset rather than leaving a player
    // bar that controls nothing.
    playingPathRef.current = null;
    setState(IDLE);
    toast.error(String(err));
  }, []);

  /**
   * `title` is taken here rather than as a hook argument on purpose: it is
   * derived from content held in a ref, which does not re-render, so a
   * render-time capture reads an empty string on the first pass and would put
   * a blank name on the lock screen.
   */
  const start = useCallback(
    (text: string, title: string, artworkBase64?: string) => {
      if (!text.trim()) return;
      const startIndex = savedIndexFor(relPath);
      playingPathRef.current = relPath;
      setState((prev) => ({ ...prev, active: true, playing: true, index: startIndex }));
      void iosSpeechStart({
        text,
        title,
        startIndex,
        rate: stateRef.current.rate * AV_DEFAULT_RATE,
        // The user's own picks win over every heuristic on the native side.
        voiceByLanguage: useMobileStore.getState().speechVoices,
        artworkBase64,
      })
        .then(({ language }) => {
          // Only if this start is still the live one — a late resolve after
          // navigation must not stamp a language onto a different article.
          if (playingPathRef.current === relPath) {
            setState((prev) => ({ ...prev, language }));
          }
        })
        .catch(fail);
    },
    [relPath, savedIndexFor, fail],
  );

  /**
   * Make `voiceId` the voice for the current article's language, from now on
   * and for every later article in that language. Applies immediately if
   * something is playing.
   */
  const chooseVoice = useCallback(
    (voiceId: string) => {
      const language = stateRef.current.language;
      if (!language) return;
      rememberSpeechVoice(language, voiceId);
      if (stateRef.current.active) void iosSpeechSetVoice(voiceId).catch(fail);
    },
    [rememberSpeechVoice, fail],
  );

  const pause = useCallback(() => {
    setState((prev) => ({ ...prev, playing: false }));
    void iosSpeechPause().catch(fail);
  }, [fail]);

  const resume = useCallback(() => {
    setState((prev) => ({ ...prev, playing: true }));
    void iosSpeechResume().catch(fail);
  }, [fail]);

  const stop = useCallback(() => {
    playingPathRef.current = null;
    setState(IDLE);
    void iosSpeechStop().catch(() => {});
  }, []);

  const skip = useCallback(
    (delta: number) => {
      void iosSpeechSkip(delta).catch(fail);
    },
    [fail],
  );

  /** Cycle to the next rate in `SPEECH_RATES`, wrapping at the end. */
  const cycleRate = useCallback(() => {
    // Computed from the ref and dispatched OUTSIDE the updater: React invokes
    // a state updater twice under StrictMode, so an IPC call in there sends
    // the rate change twice per tap.
    const current = stateRef.current.rate as (typeof SPEECH_RATES)[number];
    const next = SPEECH_RATES[(SPEECH_RATES.indexOf(current) + 1) % SPEECH_RATES.length];
    setState((prev) => ({ ...prev, rate: next }));
    void iosSpeechSetRate(next * AV_DEFAULT_RATE).catch(fail);
  }, [fail]);

  // Stop when the document changes or the reader closes.
  //
  // The player has no surface outside the reader, so leaving audio running
  // with only the lock-screen controls to stop it is worse than stopping.
  // Backgrounding and screen lock do NOT unmount the reader, so the case the
  // feature exists for is unaffected.
  useEffect(() => {
    return () => {
      playingPathRef.current = null;
      void iosSpeechStop().catch(() => {});
    };
  }, [relPath]);

  return { state, start, pause, resume, stop, skip, cycleRate, chooseVoice };
}
