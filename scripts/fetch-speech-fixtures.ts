/**
 * Download a small, labelled speech baseline for comparing Whisper models
 * (#698) — English and Swedish, each clip paired with its reference
 * transcript so word error rate is measurable rather than guessed at.
 *
 *   pnpm fetch:speech-fixtures
 *   pnpm compare:whisper tests/fixtures/speech/en-librispeech-01.wav \
 *                        tests/fixtures/speech/en-librispeech-01.txt
 *
 * Audio is written to `tests/fixtures/speech/`, which is **gitignored**: it is
 * tens of megabytes, it is third-party material under its own licences, and
 * it is reproducible from this script. Only the script is committed.
 *
 * Sources, all openly licensed and all shipping reference transcripts:
 *
 *   - **LibriSpeech** (`test-clean`, CC BY 4.0) — read English, studio-clean.
 *     The standard ASR baseline; if a model struggles here it will struggle
 *     everywhere.
 *   - **FLEURS** (`sv_se`, CC BY 4.0) — read Swedish. The reason this script
 *     exists: every English-only fixture says nothing about the language half
 *     of Notesage's users, and Whisper's model sizes diverge much more sharply
 *     outside English.
 *   - **whisper.cpp's `jfk.wav`** — a US government recording, public domain.
 *     Included because it is what every whisper.cpp benchmark quotes, so it
 *     lets our numbers be compared against published ones.
 *
 * These are all READ speech: clean, close-miked, fluent. Real meetings are
 * none of those things, so treat the results as a floor — the ranking between
 * models transfers, the absolute error rates do not. For a number that
 * reflects your own use, record yourself and write down what you said.
 */

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const OUT_DIR = join(import.meta.dirname, '..', 'tests', 'fixtures', 'speech');
const ROWS = 'https://datasets-server.huggingface.co/rows';

interface Clip {
  id: string;
  url: string;
  text: string;
}

async function datasetClips(
  dataset: string,
  config: string,
  split: string,
  count: number,
  prefix: string,
): Promise<Clip[]> {
  const url =
    `${ROWS}?dataset=${encodeURIComponent(dataset)}&config=${config}` +
    `&split=${split}&offset=0&length=${count}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${dataset}: HTTP ${res.status}`);
  const body = (await res.json()) as {
    error?: string;
    rows?: Array<{ row: Record<string, unknown> }>;
  };
  if (body.error) throw new Error(`${dataset}: ${body.error}`);

  return (body.rows ?? []).map((entry, i) => {
    const row = entry.row;
    const audio = row.audio as Array<{ src: string }> | { src: string };
    const src = Array.isArray(audio) ? audio[0].src : audio.src;
    // LibriSpeech calls it `text`; FLEURS calls it `transcription`.
    const text = String(row.text ?? row.transcription ?? '').trim();
    return { id: `${prefix}-${String(i + 1).padStart(2, '0')}`, url: src, text };
  });
}

/**
 * Fetch and normalise to what Whisper actually consumes: 16 kHz mono 16-bit
 * PCM. The datasets serve various formats and rates; converting once here
 * means the comparison measures the MODELS rather than each clip's decode
 * path, and it keeps the harness's WAV reader simple.
 */
function toWav(sourceUrl: string, destination: string): void {
  execFileSync(
    'ffmpeg',
    ['-nostdin', '-loglevel', 'error', '-y', '-i', sourceUrl,
     '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', destination],
    { stdio: 'inherit' },
  );
}

async function main(): Promise<void> {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('ffmpeg is required (brew install ffmpeg).');
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const written: string[] = [];

  // Public-domain reference clip, straight from the whisper.cpp repo.
  const jfk = join(OUT_DIR, 'en-jfk.wav');
  if (!existsSync(jfk)) {
    const res = await fetch(
      'https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav',
    );
    writeFileSync(jfk, Buffer.from(await res.arrayBuffer()));
  }
  written.push('en-jfk.wav (no reference transcript — timings only)');

  const sets: Array<[string, string, string, number, string]> = [
    ['openslr/librispeech_asr', 'clean', 'test', 10, 'en-librispeech'],
    ['google/fleurs', 'sv_se', 'validation', 10, 'sv-fleurs'],
  ];

  for (const [dataset, config, split, count, prefix] of sets) {
    let clips: Clip[];
    try {
      clips = await datasetClips(dataset, config, split, count, prefix);
    } catch (e) {
      // A dataset going away must not cost the clips already fetched — the
      // baseline is still usable with whatever arrived.
      console.warn(`skipped ${dataset}: ${(e as Error).message}`);
      continue;
    }
    for (const clip of clips) {
      const wav = join(OUT_DIR, `${clip.id}.wav`);
      if (!existsSync(wav)) toWav(clip.url, wav);
      writeFileSync(join(OUT_DIR, `${clip.id}.txt`), `${clip.text}\n`);
      written.push(`${clip.id}.wav + .txt`);
    }
  }

  console.log(`\nFixtures in ${OUT_DIR}:`);
  for (const line of written) console.log(`  ${line}`);
  console.log(
    '\nCompare models with:\n' +
      '  pnpm compare:whisper tests/fixtures/speech/<clip>.wav tests/fixtures/speech/<clip>.txt\n' +
      '\nThese are READ speech — clean and fluent. The ranking between models\n' +
      'transfers to real meetings; the absolute error rates do not.',
  );
}

void main();
