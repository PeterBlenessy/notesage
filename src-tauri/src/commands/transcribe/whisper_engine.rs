//! The real speech engine: whisper.cpp through `whisper-rs`.
//!
//! Kept thin on purpose. Nothing here can be exercised without a model file,
//! so everything worth testing (parts, timestamps, progress, cancel) lives in
//! `pipeline` behind the [`SpeechEngine`] trait.

use super::engine::{EngineOutput, EngineProgress, EngineSegment, SpeechEngine, AUTO_LANGUAGE};
use std::ffi::{c_int, c_void};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// The loaded model, cached between jobs: `(model name, context)`.
pub type ModelSlot = Option<(String, whisper_rs::WhisperContext)>;

/// Borrows the model slot for one job. The caller holds the slot's lock for
/// as long as this exists, which is what makes "load the model" and "run
/// inference with it" one step: no other job can swap the model in between.
pub struct WhisperEngine<'a> {
    slot: &'a mut ModelSlot,
    model: String,
    model_path: String,
}

impl<'a> WhisperEngine<'a> {
    pub fn new(slot: &'a mut ModelSlot, model: &str, model_path: &str) -> Self {
        Self { slot, model: model.to_string(), model_path: model_path.to_string() }
    }
}

/// Whisper's progress callback. `user_data` is the `EngineProgress` on the
/// stack of the `transcribe` call that is running `full()`.
unsafe extern "C" fn progress_trampoline(
    _ctx: *mut whisper_rs::WhisperSysContext,
    _state: *mut whisper_rs::WhisperSysState,
    progress: c_int,
    user_data: *mut c_void,
) {
    if user_data.is_null() {
        return;
    }
    // SAFETY: set in `transcribe` to a pointer to its `progress` argument,
    // which outlives the `full()` call that invokes this.
    let callback = &*(user_data as *const EngineProgress);
    // A panic must not unwind into C.
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| callback(progress)));
}

/// Whisper's abort callback: polled after every encoder and decoder step.
/// `user_data` is the job's cancel flag.
unsafe extern "C" fn abort_trampoline(user_data: *mut c_void) -> bool {
    if user_data.is_null() {
        return false;
    }
    // SAFETY: set in `transcribe` to the `AtomicBool` inside its `cancel`
    // argument, which outlives the `full()` call that invokes this.
    let flag = &*(user_data as *const AtomicBool);
    flag.load(Ordering::Relaxed)
}

impl SpeechEngine for WhisperEngine<'_> {
    fn prepare(&mut self) -> Result<(), String> {
        let loaded = matches!(self.slot.as_ref(), Some((name, _)) if *name == self.model);
        if loaded {
            return Ok(());
        }
        // Free the previous model before loading another: two at once is
        // what runs a 16 GB machine out of memory.
        *self.slot = None;
        log::info!(target: "notesage::transcription", "Loading Whisper model: {} ({})", self.model, self.model_path);
        let started = std::time::Instant::now();
        let params = whisper_rs::WhisperContextParameters::default();
        let ctx = whisper_rs::WhisperContext::new_with_params(&self.model_path, params)
            .map_err(|e| format!("Failed to load Whisper model: {}", e))?;
        log::info!(target: "notesage::transcription", "Model loaded in {:.1}s", started.elapsed().as_secs_f64());
        *self.slot = Some((self.model.clone(), ctx));
        Ok(())
    }

    fn transcribe(
        &mut self,
        samples: &[f32],
        language: &str,
        progress: EngineProgress,
        cancel: Arc<AtomicBool>,
    ) -> Result<EngineOutput, String> {
        let (_, ctx) = self.slot.as_ref().ok_or("Whisper context not loaded")?;

        let mut params =
            whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        // "auto" asks whisper.cpp to detect the spoken language.
        params.set_language(Some(language));

        // The raw callbacks, not `set_*_callback_safe`: those box the closure
        // and never free it, and in whisper-rs 0.16.0 the safe abort variant
        // hands the C side a pointer to a boxed trait object while its
        // trampoline reads it as the closure itself. Here the user data are
        // plain pointers to values this function owns for the whole call.
        //
        // SAFETY: `progress` and `cancel` are owned by this stack frame and
        // are not moved or dropped before `full()` returns; the trampolines
        // only read through the pointers.
        unsafe {
            params.set_progress_callback(Some(progress_trampoline));
            params.set_progress_callback_user_data(&progress as *const EngineProgress as *mut c_void);
            params.set_abort_callback(Some(abort_trampoline));
            params.set_abort_callback_user_data(Arc::as_ptr(&cancel) as *mut c_void);
        }

        let mut state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create Whisper state: {}", e))?;

        state
            .full(params, samples)
            .map_err(|e| format!("Transcription failed: {}", e))?;

        let language = if language == AUTO_LANGUAGE {
            whisper_rs::get_lang_str(state.full_lang_id_from_state()).map(|s| s.to_string())
        } else {
            Some(language.to_string())
        };

        let count = state.full_n_segments();
        let mut segments = Vec::with_capacity(count.max(0) as usize);
        for i in 0..count {
            let seg = state
                .get_segment(i)
                .ok_or_else(|| format!("Segment {} out of bounds", i))?;
            let text = seg
                .to_str_lossy()
                .map_err(|e| format!("Failed to get segment text: {}", e))?
                .trim()
                .to_string();
            segments.push(EngineSegment {
                // Whisper counts in hundredths of a second.
                start: seg.start_timestamp() as f64 / 100.0,
                end: seg.end_timestamp() as f64 / 100.0,
                text,
            });
        }

        // `progress` and `cancel` must stay alive until here (see SAFETY).
        drop(state);
        drop(progress);
        drop(cancel);
        Ok(EngineOutput { segments, language })
    }
}
