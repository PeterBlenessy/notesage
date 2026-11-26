//! Which voice models the app uses, where they come from and where they are
//! kept. Models are downloaded on demand, like the Whisper models, and never
//! bundled with the app.

use std::path::{Path, PathBuf};

pub struct SpeakerModel {
    /// Stable identifier. Stored in every voice profile: an embedding is only
    /// comparable with embeddings of the same model.
    pub id: &'static str,
    /// Shown to the user.
    pub name: &'static str,
    pub file_name: &'static str,
    pub url: &'static str,
    pub size_bytes: u64,
    /// SHA-256 of the file, lowercase hex.
    pub sha256: &'static str,
    pub licence: &'static str,
    /// Where the model and its licence are published.
    pub source: &'static str,
    /// Length of its embeddings.
    pub dim: usize,
}

/// WeSpeaker ResNet34-LM, trained on VoxCeleb2 (0.72 % EER on VoxCeleb1-O),
/// in the ONNX export that the sherpa-onnx project republishes on GitHub.
///
/// The hash was computed from the file as downloaded from `url` on
/// 2026-11-26, and that same file was run (see `docs/features/speakers.md`);
/// it has not been compared with a hash published by WeSpeaker, which
/// publishes none.
const EMBEDDING: SpeakerModel = SpeakerModel {
    id: "wespeaker-voxceleb-resnet34-lm",
    name: "WeSpeaker ResNet34 (voice embeddings)",
    file_name: "wespeaker_en_voxceleb_resnet34_LM.onnx",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx",
    size_bytes: 26_530_550,
    sha256: "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012",
    licence: "CC-BY-4.0 (WeSpeaker, trained on VoxCeleb)",
    source: "https://github.com/wenet-e2e/wespeaker/blob/master/docs/pretrained.md",
    dim: 256,
};

/// Every model speaker identification needs. One today.
pub const SPEAKER_MODELS: &[SpeakerModel] = &[EMBEDDING];

/// The model embeddings are computed with.
pub fn embedding_model() -> &'static SpeakerModel {
    &SPEAKER_MODELS[0]
}

/// `~/.notesage/speaker-models/`.
pub fn default_models_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".notesage")
        .join("speaker-models")
}

pub fn model_path(dir: &Path, model: &SpeakerModel) -> PathBuf {
    dir.join(model.file_name)
}

/// The partial file a download of `model` is written to (and continued from).
pub fn temp_path(dir: &Path, model: &SpeakerModel) -> PathBuf {
    dir.join(format!("{}.downloading", model.file_name))
}

/// A model counts as installed when its file is there with the catalogue
/// size (the hash was checked when it was downloaded).
pub fn is_installed(dir: &Path, model: &SpeakerModel) -> bool {
    std::fs::metadata(model_path(dir, model)).map(|m| m.is_file() && m.len() == model.size_bytes).unwrap_or(false)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SpeakerModelInfo {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub installed: bool,
    pub licence: String,
    pub source: String,
    pub download_url: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SpeakerModelsStatus {
    /// True when every model is installed.
    pub installed: bool,
    pub models: Vec<SpeakerModelInfo>,
}

pub fn status(dir: &Path) -> SpeakerModelsStatus {
    let models: Vec<SpeakerModelInfo> = SPEAKER_MODELS
        .iter()
        .map(|m| SpeakerModelInfo {
            id: m.id.to_string(),
            name: m.name.to_string(),
            size_bytes: m.size_bytes,
            installed: is_installed(dir, m),
            licence: m.licence.to_string(),
            source: m.source.to_string(),
            download_url: m.url.to_string(),
        })
        .collect();
    SpeakerModelsStatus { installed: models.iter().all(|m| m.installed), models }
}

/// Remove every model file and partial download. Returns how many files went.
/// Voice profiles are NOT touched: they stay, and are usable again once the
/// same model is downloaded.
pub fn delete_all(dir: &Path) -> Result<usize, String> {
    let mut removed = 0;
    for m in SPEAKER_MODELS {
        for path in [model_path(dir, m), temp_path(dir, m)] {
            match std::fs::remove_file(&path) {
                Ok(()) => removed += 1,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("Could not delete {}: {e}", path.display())),
            }
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("notesage-speaker-models-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_catalogue_is_well_formed() {
        assert!(!SPEAKER_MODELS.is_empty());
        for m in SPEAKER_MODELS {
            assert!(m.url.starts_with("https://"));
            assert!(m.url.ends_with(m.file_name));
            assert_eq!(m.sha256.len(), 64);
            assert!(m.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
            assert!(m.size_bytes > 1_000_000);
            assert!(!m.licence.is_empty() && !m.source.is_empty());
            assert!(m.dim > 0);
        }
        let mut ids: Vec<&str> = SPEAKER_MODELS.iter().map(|m| m.id).collect();
        ids.dedup();
        assert_eq!(ids.len(), SPEAKER_MODELS.len());
    }

    #[test]
    fn status_and_delete() {
        let dir = temp_dir("status");
        let m = embedding_model();
        let s = status(&dir);
        assert!(!s.installed);
        assert_eq!(s.models.len(), SPEAKER_MODELS.len());
        assert!(!s.models[0].installed);
        assert_eq!(s.models[0].id, m.id);

        // A file of the wrong size (a truncated copy) is not "installed".
        std::fs::write(model_path(&dir, m), b"short").unwrap();
        assert!(!status(&dir).installed);

        // The right size is.
        let f = std::fs::File::create(model_path(&dir, m)).unwrap();
        f.set_len(m.size_bytes).unwrap();
        drop(f);
        assert!(status(&dir).installed);

        std::fs::write(temp_path(&dir, m), b"partial").unwrap();
        std::fs::write(dir.join("unrelated.txt"), b"keep").unwrap();
        assert_eq!(delete_all(&dir).unwrap(), 2);
        assert!(!status(&dir).installed);
        assert!(dir.join("unrelated.txt").exists());
        assert_eq!(delete_all(&dir).unwrap(), 0);
        // A directory that does not exist is "nothing to delete".
        assert_eq!(delete_all(&dir.join("nope")).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_status_serialises_with_the_contract_field_names() {
        let json = serde_json::to_value(status(Path::new("/nonexistent"))).unwrap();
        assert_eq!(json["installed"], false);
        let m = &json["models"][0];
        for key in ["id", "name", "size_bytes", "installed", "licence", "source", "download_url"] {
            assert!(m.get(key).is_some(), "missing {key}");
        }
    }
}
