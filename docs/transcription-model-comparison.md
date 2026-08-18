# Whisper model comparison

Measured answers to "which model should Notesage ship, and does `small` earn
its place" (#698), and to what auto-detection actually costs (#699).

Re-measure rather than trusting these numbers as they age:

```bash
pnpm compare:whisper-corpus tests/fixtures/speech sv-fleurs     # auto-detect
WHISPER_LANG=sv pnpm compare:whisper-corpus tests/fixtures/speech sv-fleurs
```

Corpus: 10 Swedish clips (FLEURS) and 10 English (LibriSpeech), each with a
reference transcript. Fetch with `pnpm fetch:speech-fixtures`; they are
gitignored, being several MB of audio.

---

## 2026-08-18 — Apple M3, 8 cores, 24 GB

Whisper.cpp via `whisper-rs`, Metal enabled. WER against the reference
transcript; `worst` is the worst single clip, which matters more than the mean
(see below).

### Swedish, language pinned (`WHISPER_LANG=sv`)

| model | mean WER | median | worst | mean time | peak RAM |
| --- | --- | --- | --- | --- | --- |
| large-v3-q5_0 | 10.4% | 5.1% | 33.3% | 3.4s | 1.4 GB |
| large-v3-turbo | 10.6% | 10.0% | 30.0% | 2.2s | 1.8 GB |
| large-v3 | 10.7% | 6.5% | 33.3% | 4.4s | 3.5 GB |
| **large-v3-turbo-q5_0** | **11.0%** | 7.3% | 30.0% | 2.7s | **0.6 GB** |
| medium | 16.6% | 12.2% | 40.0% | 2.1s | 1.9 GB |
| medium-q5_0 | 18.2% | 17.4% | 40.0% | 1.9s | 0.8 GB |
| small | 25.6% | 25.9% | 56.7% | 0.6s | 0.7 GB |
| base | 46.3% | 48.8% | 73.3% | 0.2s | 0.2 GB |
| tiny | 53.3% | 50.0% | 83.3% | 0.1s | 0.2 GB |

### English, language pinned (`WHISPER_LANG=en`)

| model | mean WER | median | worst | mean time | peak RAM |
| --- | --- | --- | --- | --- | --- |
| large-v3-turbo | 0.6% | 0.0% | 3.2% | 2.1s | 1.8 GB |
| large-v3-turbo-q5_0 | 0.6% | 0.0% | 3.2% | 2.4s | 0.6 GB |
| medium | 0.7% | 0.0% | 4.2% | 1.8s | 1.9 GB |
| medium-q5_0 | 0.7% | 0.0% | 4.2% | 1.5s | 0.8 GB |
| small | 1.0% | 0.0% | 4.2% | 0.5s | 0.7 GB |
| large-v3 | 1.8% | 0.0% | 11.8% | 3.4s | 3.4 GB |
| large-v3-q5_0 | 1.8% | 0.0% | 11.8% | 3.0s | 1.4 GB |
| base | 2.9% | 0.0% | 12.5% | 0.2s | 0.2 GB |
| tiny | 5.1% | 2.8% | 18.2% | 0.1s | 0.2 GB |

LibriSpeech is clean read English and every model does well on it — which is
exactly why a comparison run only on English fixtures would have picked the
wrong model. Swedish separates them; English does not.

---

## What auto-detection costs

`recording-store.speechLanguage` defaults to `'auto'`. Same Swedish corpus,
same models, the only difference being whether the language was pinned:

| model | auto-detect | pinned `sv` | cost of auto |
| --- | --- | --- | --- |
| large-v3 | 20.0% | 10.7% | **+9.3** |
| large-v3-q5_0 | 20.4% | 10.4% | **+10.0** |
| medium | 23.8% | 16.6% | +7.2 |
| medium-q5_0 | 22.5% | 18.2% | +4.3 |
| small | 30.6% | 25.6% | +5.0 |
| base | 51.3% | 46.3% | +5.0 |
| tiny | 66.5% | 53.3% | +13.2 |
| large-v3-turbo | 10.6% | 10.6% | 0.0 |
| large-v3-turbo-q5_0 | 11.0% | 11.0% | 0.0 |

Every model pays except the two turbo variants, which detect Swedish
reliably. English pays nothing at all — detection there is never wrong.

### The failure is misdetection, not mishearing

`sv-fleurs-03` scored **100% WER** on `large-v3` under auto-detect. Reference:

> de första fallen av sjukdomen under den här säsongen rapporterades i slutet
> av juli

What the models produced:

| model | detected | output |
| --- | --- | --- |
| large-v3 | `sq` | Tëm fështë ta falen avë shëkëdumen under den herë sezongen, raporterat e si slytet avë julli. |
| medium | `sq` | Tëmë fërshëtë afalen av shëgdumën under dën herë sezongën… |
| small | `de` | Beim 1. Fallen auf Höchstdummen unter den Herzen Rapporterat es ist lüttet auf Juli. |
| large-v3-turbo | `sv` | De första fallen av sjukdomen under den här säsongen rapporterades i slutet av juli. |

`large-v3` heard the audio essentially correctly and then wrote it in Albanian
orthography, because it decided the clip was Albanian. Pinning the language
takes that clip from **100% to 7.1%**, and `large-v3-q5_0` from **100% to 0%**.

This is worth stating plainly because the mean hides it: a model can be
excellent at Swedish and still score terribly, purely on a detection coin-flip.
Read `worst` before `mean`.

---

## What the numbers say

**The full `large-v3` earns nothing.** All four large-v3 variants land within
0.6 points of each other on Swedish (10.4–11.0%) and are identical on English.
`large-v3-turbo-q5_0` gets there in **0.6 GB** against `large-v3`'s **3.5 GB**
— a 5.8× difference for no measurable accuracy.

**`small` is the weak link, and it is weak where it matters.** At 1.0% on
English it looks fine; at 25.6% on Swedish it is 2.3× the error of the large
tier. Its only remaining advantage is speed (0.6s vs 2.7s) — but
`large-v3-turbo-q5_0` needs *less* RAM than `small` does (0.6 GB vs 0.7 GB), so
the usual "small fits where large won't" argument does not hold against the
quantized turbo.

**Auto-detect is expensive for non-English.** It is the shipped default, and on
this corpus it costs Swedish users up to 10 points of WER on the very models
they would otherwise want. The two turbo variants are immune.

These are measurements, not decisions — what to ship follows from them but is
not settled here.
