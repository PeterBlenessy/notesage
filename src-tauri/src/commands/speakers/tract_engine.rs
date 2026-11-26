//! The real voice model: a WeSpeaker ResNet34 speaker-embedding network in
//! ONNX form, run with `tract` (pure Rust, no native library to ship, sign
//! or load). Everything model-specific is here and in `models`; the rest of
//! the pipeline only sees [`VoiceEngine`].

use super::engine::{VoiceEngine, WINDOW_SAMPLES};
use super::fbank::{frame_count, Fbank, NUM_MELS};
use std::path::Path;
use tract_onnx::prelude::*;

type Plan = SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>;

pub struct TractVoiceEngine {
    model_id: String,
    dim: usize,
    frames: usize,
    fbank: Fbank,
    plan: Plan,
}

impl TractVoiceEngine {
    /// Load the ONNX file at `path` and specialise it to one window of
    /// audio. Takes a fraction of a second; the model needs about 30 MB.
    pub fn load(path: &Path, model_id: &str) -> Result<Self, String> {
        let frames = frame_count(WINDOW_SAMPLES);
        let plan = tract_onnx::onnx()
            .model_for_path(path)
            .and_then(|m| {
                m.with_input_fact(
                    0,
                    InferenceFact::dt_shape(f32::datum_type(), [1usize, frames, NUM_MELS]),
                )
            })
            .and_then(|m| m.into_optimized())
            .and_then(|m| m.into_runnable())
            .map_err(|e| format!("Could not load the voice model {}: {e}", path.display()))?;
        let mut engine =
            Self { model_id: model_id.to_string(), dim: 0, frames, fbank: Fbank::new(), plan };
        // One run on silence: finds the output size, and fails here rather
        // than in the middle of a recording if the file is not this model.
        engine.dim = engine.embed_window(&vec![0.0; WINDOW_SAMPLES])?.len();
        if engine.dim == 0 {
            return Err("The voice model returned an empty embedding".into());
        }
        Ok(engine)
    }
}

impl VoiceEngine for TractVoiceEngine {
    fn model_id(&self) -> &str {
        &self.model_id
    }

    fn dim(&self) -> usize {
        self.dim
    }

    fn embed_window(&self, window: &[f32]) -> Result<Vec<f32>, String> {
        if window.len() != WINDOW_SAMPLES {
            return Err(format!(
                "The voice model takes {WINDOW_SAMPLES} samples at a time, got {}",
                window.len()
            ));
        }
        let features = self.fbank.compute(window);
        let input = Tensor::from_shape(&[1, self.frames, NUM_MELS], &features)
            .map_err(|e| format!("Voice model input: {e}"))?;
        let out = self
            .plan
            .run(tvec!(input.into()))
            .map_err(|e| format!("The voice model failed: {e}"))?;
        let view = out
            .first()
            .ok_or("The voice model returned nothing")?
            .to_array_view::<f32>()
            .map_err(|e| format!("Voice model output: {e}"))?;
        Ok(view.iter().copied().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::speakers::engine::cosine;
    use crate::commands::speakers::models;

    /// Runs only when the model has been downloaded (or
    /// `NOTESAGE_SPEAKER_MODEL` points at it); otherwise it passes without
    /// doing anything, so CI needs no model file.
    #[test]
    fn real_model_smoke_test_when_the_model_is_present() {
        let path = std::env::var_os("NOTESAGE_SPEAKER_MODEL")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| models::model_path(&models::default_models_dir(), models::embedding_model()));
        if !path.exists() {
            eprintln!("skipped: no voice model at {}", path.display());
            return;
        }
        let engine = TractVoiceEngine::load(&path, models::embedding_model().id).unwrap();
        assert_eq!(engine.dim(), models::embedding_model().dim);

        // Two harmonic "voices": the same one twice must be closer than two
        // different ones, and the output must be deterministic.
        let voice = |f0: f32, secs: f32| -> Vec<f32> {
            (0..(secs * 16_000.0) as usize)
                .map(|i| {
                    let t = i as f32 / 16_000.0;
                    (1..20)
                        .map(|k| (2.0 * std::f32::consts::PI * f0 * k as f32 * t).sin() / k as f32)
                        .sum::<f32>()
                        * 0.2
                })
                .collect()
        };
        let a1 = engine.embed(&voice(110.0, 3.0)).unwrap();
        let a2 = engine.embed(&voice(110.0, 4.5)).unwrap();
        let b = engine.embed(&voice(230.0, 3.0)).unwrap();
        assert_eq!(a1, engine.embed(&voice(110.0, 3.0)).unwrap());
        assert!((a1.iter().map(|x| x * x).sum::<f32>().sqrt() - 1.0).abs() < 1e-3);
        assert!(
            cosine(&a1, &a2) > cosine(&a1, &b),
            "same {} different {}",
            cosine(&a1, &a2),
            cosine(&a1, &b)
        );
        assert!(engine.embed_window(&[0.0; 100]).is_err());
    }

    #[test]
    fn a_file_that_is_not_a_model_is_an_error_not_a_panic() {
        let dir = std::env::temp_dir().join(format!("notesage-speaker-bad-model-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bad.onnx");
        std::fs::write(&path, b"this is not an onnx file").unwrap();
        let err = TractVoiceEngine::load(&path, "x").err().unwrap();
        assert!(err.starts_with("Could not load the voice model"), "{err}");
        assert!(TractVoiceEngine::load(&dir.join("missing.onnx"), "x").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
