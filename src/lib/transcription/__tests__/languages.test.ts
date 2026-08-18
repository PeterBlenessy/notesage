// @vitest-environment jsdom
/**
 * Transcription language defaults and the model/language mismatch guard.
 *
 * The measurement behind these rules is in
 * `docs/transcription-model-comparison.md`: auto-detect costs non-English
 * transcription up to 10 points of word error, and once turned a Swedish clip
 * into fluent Albanian. So the default follows the device, and the one
 * genuinely bad pairing is called out rather than discovered in the output.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SPEECH_LANGUAGES,
  speechLanguageLabel,
  detectSpeechLanguage,
  isLanguageMismatch,
} from '@/lib/transcription/languages';

function withNavigatorLanguages(languages: string[]): void {
  vi.stubGlobal('navigator', { languages, language: languages[0] });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectSpeechLanguage', () => {
  it('follows the device language', () => {
    withNavigatorLanguages(['sv-SE', 'en-US']);
    expect(detectSpeechLanguage()).toBe('sv');
  });

  it('ignores the region subtag', () => {
    // A Finland-Swedish device should transcribe Swedish, not fall through.
    withNavigatorLanguages(['sv-FI']);
    expect(detectSpeechLanguage()).toBe('sv');
  });

  it('takes the first language we actually offer', () => {
    withNavigatorLanguages(['gd-GB', 'de-DE']);
    expect(detectSpeechLanguage()).toBe('de');
  });

  it('falls back to English, never to auto-detect', () => {
    // The point of the whole change: an unsupported device language must not
    // land the user on auto-detect, which is the failure mode being avoided.
    withNavigatorLanguages(['gd-GB']);
    expect(detectSpeechLanguage()).toBe('en');
  });

  it('survives a missing navigator', () => {
    vi.stubGlobal('navigator', undefined);
    expect(detectSpeechLanguage()).toBe('en');
  });

  it('never returns a value the picker cannot show', () => {
    withNavigatorLanguages(['sv-SE']);
    const values = SPEECH_LANGUAGES.map((l) => l.value);
    expect(values).toContain(detectSpeechLanguage());
  });
});

describe('isLanguageMismatch', () => {
  it('flags the English-only models on another language', () => {
    // `small` is 1.0% word error on English and 25.6% on Swedish — not a
    // gentle degradation, roughly one word in four.
    expect(isLanguageMismatch('small', 'sv')).toBe(true);
    expect(isLanguageMismatch('base', 'de')).toBe(true);
    expect(isLanguageMismatch('tiny', 'fr')).toBe(true);
  });

  it('flags them on auto-detect too', () => {
    // Auto-detect is how these models end up transcribing the wrong language
    // in the first place, and they have no headroom to recover from it.
    expect(isLanguageMismatch('small', 'auto')).toBe(true);
  });

  it('stays quiet for those models on English', () => {
    expect(isLanguageMismatch('small', 'en')).toBe(false);
  });

  it('stays quiet for the multilingual model on any language', () => {
    expect(isLanguageMismatch('large-v3-turbo-q5_0', 'sv')).toBe(false);
    expect(isLanguageMismatch('large-v3-turbo-q5_0', 'auto')).toBe(false);
  });
});

describe('speechLanguageLabel', () => {
  it('names a known language', () => {
    expect(speechLanguageLabel('sv')).toBe('Swedish');
  });

  it('passes an unknown code through rather than showing nothing', () => {
    // A stored value from a future list is more useful shown raw than blank.
    expect(speechLanguageLabel('xx')).toBe('xx');
  });
});
