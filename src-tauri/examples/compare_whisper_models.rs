//! Compare every downloaded Whisper model on ONE recording (#698).
//!
//! Answers the question that decides whether a model size earns its place:
//! for this audio, in this language, on this machine — what does each model
//! actually produce, how long does it take, and how much memory does it hold?
//!
//! Deliberately manual, like `calibrate_model_fit.rs`: it needs real
//! downloaded models and real hardware, so it cannot run in CI.
//!
//! ```sh
//! cargo run --release --example compare_whisper_models -- meeting.wav
//! cargo run --release --example compare_whisper_models -- meeting.wav truth.txt
//! ```
//!
//! With a reference transcript it reports **word error rate**, which is the
//! only way to tell `small` from `medium` honestly — by ear they both sound
//! plausible until you check them against what was actually said. Without
//! one it prints the transcripts for you to read, and says so rather than
//! implying a measurement it did not make.
//!
//! Language is left to Whisper's own detection (`None`), so the run doubles
//! as a check on auto-detection (#699) — the detected language is printed per
//! model, and a model that detects wrong will usually also transcribe wrong.

use std::path::{Path, PathBuf};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let Some(audio_arg) = args.get(1) else {
        eprintln!("usage: compare_whisper_models <audio.wav> [reference.txt]");
        std::process::exit(2);
    };
    let audio_path = PathBuf::from(audio_arg);
    let reference = args.get(2).map(|p| {
        std::fs::read_to_string(p).unwrap_or_else(|e| {
            eprintln!("Could not read reference transcript {p}: {e}");
            std::process::exit(2);
        })
    });

    let audio = match load_16k_mono(&audio_path) {
        Ok(samples) => samples,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    let seconds = audio.len() as f64 / 16_000.0;
    println!("Audio: {} ({:.1}s)", audio_path.display(), seconds);
    if reference.is_none() {
        println!("No reference transcript given — reporting timings and text only, NOT accuracy.");
    }
    println!();

    // Optional pin — see the note at `set_language` below.
    let forced_language: Option<String> = std::env::var("WHISPER_LANG").ok().filter(|v| !v.is_empty());
    if let Some(lang) = &forced_language {
        println!("Language pinned to {lang} (WHISPER_LANG)");
    }

    let models = downloaded_models();
    if models.is_empty() {
        eprintln!("No models in ~/.notesage/whisper-models — download some in Settings → Voice.");
        std::process::exit(1);
    }

    let mut rows = Vec::new();
    for (name, path) in &models {
        print!("{name} … ");
        use std::io::Write;
        let _ = std::io::stdout().flush();

        let before_rss = rss_bytes();
        let load_start = Instant::now();
        let ctx = match whisper_rs::WhisperContext::new_with_params(
            path,
            whisper_rs::WhisperContextParameters::default(),
        ) {
            Ok(ctx) => ctx,
            Err(e) => {
                println!("failed to load: {e}");
                continue;
            }
        };
        let load_secs = load_start.elapsed().as_secs_f64();

        let mut params =
            whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        // None = let Whisper detect. See the module note.
        //
        // `WHISPER_LANG=sv` pins it instead, which separates two failures the
        // default run cannot tell apart: a model that mis-HEARS the speech, and
        // one that hears it correctly but decides it is another language and
        // writes it in that language's orthography. The second looks
        // catastrophic in WER terms and is entirely fixed by the language
        // setting the app already has.
        params.set_language(forced_language.as_deref().or(None));

        let mut state = match ctx.create_state() {
            Ok(s) => s,
            Err(e) => {
                println!("failed to create state: {e}");
                continue;
            }
        };

        let run_start = Instant::now();
        if let Err(e) = state.full(params, &audio) {
            println!("transcription failed: {e}");
            continue;
        }
        let run_secs = run_start.elapsed().as_secs_f64();
        let peak_rss = rss_bytes().saturating_sub(before_rss);

        let mut text = String::new();
        for i in 0..state.full_n_segments() {
            if let Some(segment) = state.get_segment(i) {
                if let Ok(chunk) = segment.to_str_lossy() {
                    text.push_str(&chunk);
                }
            }
        }
        let text = text.trim().to_string();

        // Which language Whisper decided on — the same detection #699 puts
        // behind a Labs flag. A model that detects wrong usually transcribes
        // wrong too, so it belongs beside the numbers.
        let lang = whisper_rs::get_lang_str(state.full_lang_id_from_state())
            .unwrap_or("?")
            .to_string();

        let wer = reference.as_ref().map(|truth| word_error_rate(truth, &text));
        println!("{run_secs:.1}s");
        rows.push((name.clone(), load_secs, run_secs, peak_rss, wer, lang, text));
    }

    println!("\n{:<12} {:>8} {:>9} {:>10} {:>6} {:>8}", "model", "load", "transcribe", "peak RAM", "lang", "WER");
    println!("{}", "-".repeat(60));
    for (name, load, run, rss, wer, lang, _) in &rows {
        let wer_cell = wer.map(|w| format!("{:.1}%", w * 100.0)).unwrap_or_else(|| "—".into());
        println!(
            "{:<12} {:>7.1}s {:>8.1}s {:>9.1}GB {:>6} {:>8}",
            name,
            load,
            run,
            *rss as f64 / 1e9,
            lang,
            wer_cell
        );
    }
    println!("\nRealtime factor is transcribe ÷ {seconds:.1}s of audio.");

    println!("\n--- transcripts ---");
    for (name, _, _, _, _, lang, text) in &rows {
        println!("\n[{name} · detected {lang}]\n{text}");
    }
}

/// Models the app has downloaded, smallest first by file size.
fn downloaded_models() -> Vec<(String, PathBuf)> {
    let dir = dirs::home_dir()
        .map(|h| h.join(".notesage/whisper-models"))
        .unwrap_or_default();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut models: Vec<(String, PathBuf, u64)> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension()?.to_str()? != "bin" {
                return None;
            }
            let size = e.metadata().ok()?.len();
            let name = path.file_stem()?.to_string_lossy().replace("ggml-", "");
            Some((name, path, size))
        })
        .collect();
    models.sort_by_key(|(_, _, size)| *size);
    models.into_iter().map(|(n, p, _)| (n, p)).collect()
}

/// Resident set size of this process, for a rough peak-memory delta.
fn rss_bytes() -> u64 {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    let pid = Pid::from_u32(std::process::id());
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );
    sys.process(pid).map(|p| p.memory()).unwrap_or(0)
}

/// Minimal 16-bit PCM WAV reader + linear resample to 16 kHz mono, mirroring
/// what `commands/transcription.rs` does. Duplicated rather than shared: those
/// helpers are private, and an example is not worth widening their visibility
/// for.
fn load_16k_mono(path: &Path) -> Result<Vec<f32>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Not a valid WAV file".into());
    }

    let mut channels: u16 = 1;
    let mut rate: u32 = 16_000;
    let mut bits: u16 = 16;
    let mut data: Option<(usize, usize)> = None;

    let mut pos = 12usize;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let len = u32::from_le_bytes([bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]])
            as usize;
        let body = pos + 8;
        if id == b"fmt " && body + 16 <= bytes.len() {
            channels = u16::from_le_bytes([bytes[body + 2], bytes[body + 3]]);
            rate = u32::from_le_bytes([
                bytes[body + 4],
                bytes[body + 5],
                bytes[body + 6],
                bytes[body + 7],
            ]);
            bits = u16::from_le_bytes([bytes[body + 14], bytes[body + 15]]);
        } else if id == b"data" {
            data = Some((body, len.min(bytes.len().saturating_sub(body))));
        }
        pos = body + len + (len & 1);
    }

    let (offset, len) = data.ok_or("WAV has no data chunk")?;
    if bits != 16 {
        return Err(format!("Only 16-bit PCM is supported, got {bits}-bit"));
    }
    let raw: Vec<f32> = bytes[offset..offset + len]
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
        .collect();

    // Downmix, then linear-interpolate to 16 kHz.
    let mono: Vec<f32> = if channels > 1 {
        raw.chunks(channels as usize)
            .map(|f| f.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        raw
    };
    if rate == 16_000 {
        return Ok(mono);
    }
    let ratio = rate as f64 / 16_000.0;
    let out_len = (mono.len() as f64 / ratio) as usize;
    Ok((0..out_len)
        .map(|i| {
            let src = i as f64 * ratio;
            let a = src.floor() as usize;
            let b = (a + 1).min(mono.len().saturating_sub(1));
            let t = (src - a as f64) as f32;
            mono.get(a).copied().unwrap_or(0.0) * (1.0 - t) + mono.get(b).copied().unwrap_or(0.0) * t
        })
        .collect())
}

/// Word error rate: edit distance over words ÷ reference word count.
///
/// Case and punctuation are normalised away — a model writing "don't" for
/// "dont" is not an error worth counting when comparing model sizes.
fn word_error_rate(reference: &str, hypothesis: &str) -> f64 {
    let norm = |s: &str| -> Vec<String> {
        s.to_lowercase()
            .split_whitespace()
            .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
            .filter(|w| !w.is_empty())
            .collect()
    };
    let r = norm(reference);
    let h = norm(hypothesis);
    if r.is_empty() {
        return 0.0;
    }

    // Levenshtein over words, two rows.
    let mut prev: Vec<usize> = (0..=h.len()).collect();
    let mut cur = vec![0usize; h.len() + 1];
    for (i, rw) in r.iter().enumerate() {
        cur[0] = i + 1;
        for (j, hw) in h.iter().enumerate() {
            let cost = if rw == hw { 0 } else { 1 };
            cur[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[h.len()] as f64 / r.len() as f64
}
