import { toast } from "sonner";

import { articleMetaFor } from "@/lib/article-meta-cache";
import {
  iosArticleThumbnail,
  iosReadFile,
  iosSpeechPause,
  iosSpeechResume,
  iosSpeechSetRate,
  iosSpeechSetVoice,
  iosSpeechSkip,
  iosSpeechStart,
  iosSpeechStop,
  onIosSpeechEvent,
} from "@/lib/ios-api";
import { t } from "@/lib/i18n";
import type { FileEntry } from "@/lib/tauri";
import { classifyFile } from "@/components/mobile/FileRow";
import { documentToSpeechText } from "@/components/mobile/speech-text";
import { useMobileStore, type SpeechSession } from "@/stores/mobile-store";

/** Speech rates offered in the player, as AVSpeechUtterance rate multipliers. */
export const SPEECH_RATES = [0.8, 1.0, 1.25, 1.5, 2.0] as const;

/**
 * `AVSpeechUtteranceDefaultSpeechRate` is 0.5, not 1.0 — the API's rate axis
 * runs 0…1 with "normal" in the middle. Multiplying a user-facing 1.5× by 0.5
 * is what makes the slider mean what it says.
 */
const AV_DEFAULT_RATE = 0.5;

/**
 * The app-wide read-aloud controller (#833, list playback).
 *
 * The native side owns playback (it has to — audio must survive backgrounding
 * and the lock screen). This module is the one JS controller for it: it
 * writes the session into `mobile-store.speech`, which the list rows, the
 * gallery cards and the Reader's transport all render, and it does the
 * bookkeeping the native side cannot — which document a position belongs to,
 * and persisting it so a part-listened article resumes.
 *
 * Nothing here stops playback because a surface went away: leaving the
 * article for the list, or the list for the article, keeps the audio going —
 * that is the point.
 */

/** A word boundary from the player, for the highlight in the article view. */
export interface SpeechRange {
  relPath: string;
  index: number;
  location: number;
  length: number;
}

const rangeListeners = new Set<(range: SpeechRange) => void>();

/**
 * Word boundaries as the player speaks them. Kept OUT of the store on
 * purpose: several a second, and only the open article cares — a store
 * write would re-render every row's ring for each word.
 */
export function onSpeechRange(listener: (range: SpeechRange) => void): () => void {
  rangeListeners.add(listener);
  return () => {
    rangeListeners.delete(listener);
  };
}

/** Wire native player events into the store. Mount ONCE, at the app root. */
export function startSpeechEvents(): () => void {
  return onIosSpeechEvent((event) => {
    const store = useMobileStore.getState();
    const session = store.speech;
    if (!session) return;
    if (event.event === "range") {
      const range = { relPath: session.relPath, index: event.index, location: event.location, length: event.length };
      for (const listener of rangeListeners) listener(range);
      return;
    }
    if (event.event === "progress") {
      store.setSpeech({ index: event.index, total: event.total });
      // Persist the position of whichever document is actually playing —
      // never the one on screen, which may be a different article by now.
      store.rememberSpeechPosition(session.relPath, event.index);
      return;
    }
    if (event.event === "playing") {
      // Play/pause can come from the lock screen or Control Centre, which
      // never touch this code — without this the transport shows the wrong
      // icon and the next tap calls the wrong native method.
      store.setSpeech({ playing: event.playing });
      return;
    }
    // finished: the article ended (or was stopped natively). Retire the
    // session instead of leaving a Pause for something silent, and start the
    // NEXT listen from the top rather than the end.
    store.rememberSpeechPosition(session.relPath, 0);
    store.setSpeech(null);
  });
}

function fail(relPath: string, err: unknown): void {
  // A rejection here means the native player is unavailable (desktop dev,
  // the vitest harness, an older build). Reset rather than leaving a player
  // that controls nothing — but only if the session is still this one; a
  // late failure from an old start must not kill a newer article.
  if (speechFor(relPath)) useMobileStore.getState().setSpeech(null);
  toast.error(String(err));
}

/** The session, if it is this document's. */
export function speechFor(relPath: string): SpeechSession | null {
  const s = useMobileStore.getState().speech;
  return s && s.relPath === relPath ? s : null;
}

export interface StartSpeechOptions {
  relPath: string;
  /** File name — decides how the text is extracted when `text` is absent. */
  name: string;
  /** Prose already in hand (the Reader has read the document); read
   *  otherwise. */
  text?: string;
  title?: string;
  /** Lock-screen artwork, base64. Looked up for a saved page otherwise. */
  artworkBase64?: string;
}

/** Starts in flight, by document: a second tap while the file is still
 *  being read must not start the same article twice. */
const starting = new Set<string>();

/**
 * Start (or restart) reading a document aloud from its saved position.
 *
 * Everything asynchronous — the read, the header, the artwork — happens
 * BEFORE the session is written, and the native start follows the write
 * without an await in between. While the old article is still audible,
 * its progress events would otherwise land on the new document's resume
 * position (review finding). Resolves once the native player has been
 * asked to start; a document with no prose reports "nothing to read".
 */
export async function startSpeech(options: StartSpeechOptions): Promise<void> {
  const { relPath, name } = options;
  if (starting.has(relPath)) return;
  starting.add(relPath);
  try {
    const kind = classifyFile(name);
    let text = options.text ?? "";
    let title = options.title ?? name.replace(/\.[^.]+$/, "");
    if (!options.text) {
      if (kind !== "html" && kind !== "markdown" && kind !== "text") {
        toast.error(t("reader.listenNothing"));
        return;
      }
      let raw: string;
      try {
        raw = await iosReadFile(relPath);
      } catch (err) {
        toast.error(String(err));
        return;
      }
      text = documentToSpeechText(raw, kind);
      if (kind === "html" && !options.title) {
        // The capture's own header names the article; the file name is a
        // slug. Best effort only — a title must never stop the audio.
        try {
          const meta = await articleMetaFor(relPath, undefined);
          if (meta?.title) title = meta.title;
        } catch {
          // The file name stands.
        }
      }
    }
    if (!text.trim()) {
      toast.error(t("reader.listenNothing"));
      return;
    }
    // The article's lead image becomes the lock-screen artwork — the same
    // thumbnail the gallery card uses. Best effort; never a reason to fail.
    let artworkBase64 = options.artworkBase64;
    if (artworkBase64 === undefined && kind === "html") {
      artworkBase64 = await iosArticleThumbnail(relPath)
        .then((bytes) => uint8ToBase64(bytes))
        .catch(() => undefined);
    }

    // From here on, synchronous until the native call is dispatched.
    const store = useMobileStore.getState();
    const startIndex = store.speechPositions[relPath] ?? 0;
    const rate = store.speechRate;
    // Replace whatever was playing: one session, one document.
    store.setSpeech(null);
    store.setSpeech({ relPath, title, playing: true, index: startIndex, total: 0, rate, language: null });
    void iosSpeechStart({
      text,
      title,
      startIndex,
      rate: rate * AV_DEFAULT_RATE,
      // The user's own picks win over every heuristic on the native side.
      voiceByLanguage: store.speechVoices,
      artworkBase64,
    })
      .then(({ language }) => {
        // Only if this start is still the live one — a late resolve after the
        // user started another article must not stamp its language.
        if (speechFor(relPath)) useMobileStore.getState().setSpeech({ language });
      })
      .catch((err) => fail(relPath, err));
  } finally {
    starting.delete(relPath);
  }
}

export function pauseSpeech(): void {
  const session = useMobileStore.getState().speech;
  if (!session) return;
  useMobileStore.getState().setSpeech({ playing: false });
  void iosSpeechPause().catch((err) => fail(session.relPath, err));
}

export function resumeSpeech(): void {
  const session = useMobileStore.getState().speech;
  if (!session) return;
  useMobileStore.getState().setSpeech({ playing: true });
  void iosSpeechResume().catch((err) => fail(session.relPath, err));
}

export function stopSpeech(): void {
  useMobileStore.getState().setSpeech(null);
  void iosSpeechStop().catch(() => {});
}

/** Move `delta` paragraphs; negative goes back. */
export function skipSpeech(delta: number): void {
  const session = useMobileStore.getState().speech;
  if (!session) return;
  void iosSpeechSkip(delta).catch((err) => fail(session.relPath, err));
}

/** Cycle to the next rate in `SPEECH_RATES`, wrapping at the end. */
export function cycleSpeechRate(): void {
  const store = useMobileStore.getState();
  const current = store.speechRate as (typeof SPEECH_RATES)[number];
  const next = SPEECH_RATES[(SPEECH_RATES.indexOf(current) + 1) % SPEECH_RATES.length];
  store.setSpeechRate(next);
  const session = store.speech;
  if (session) void iosSpeechSetRate(next * AV_DEFAULT_RATE).catch((err) => fail(session.relPath, err));
}

/**
 * Make `voiceId` the voice for the current article's language, from now on
 * and for every later article in that language. Applies immediately.
 */
export function chooseSpeechVoice(voiceId: string): void {
  const store = useMobileStore.getState();
  const language = store.speech?.language;
  if (!language) return;
  store.rememberSpeechVoice(language, voiceId);
  const session = store.speech;
  if (session) void iosSpeechSetVoice(voiceId).catch((err) => fail(session.relPath, err));
}

/**
 * The list control's one gesture: start this document, or pause/resume it
 * if it is the one playing.
 */
export function toggleSpeech(entry: Pick<FileEntry, "path" | "name">): void {
  const session = speechFor(entry.path);
  if (!session) {
    void startSpeech({ relPath: entry.path, name: entry.name });
    return;
  }
  if (session.playing) pauseSpeech();
  else resumeSpeech();
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
