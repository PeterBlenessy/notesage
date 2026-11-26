//! Remembered voices.
//!
//! A voice profile is biometric data. The rules this file enforces:
//!
//! - Profiles live ONLY in `~/.notesage/voice-profiles/` on this Mac: not in
//!   the library, not in iCloud, not in any recording bundle, and nothing in
//!   the app syncs or exports that folder.
//! - The folder is `0700` and every file `0600`.
//! - Nothing is created or compared without `consent: true` from the caller
//!   (see [`require_consent`]); the opt-in itself is a frontend setting, this
//!   is the backstop against a UI bug.
//! - A file that cannot be read is moved aside, never deleted and never
//!   allowed to break the list. "Delete all" removes those too.
//! - An embedding only means something for the model that made it, so every
//!   profile records its model, and profiles of another model are listed
//!   (flagged) but never matched.

use super::engine::{cosine, mean_normalized, normalized};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The exact rejection when a command that creates or compares voiceprints
/// is called without consent.
pub const CONSENT_REQUIRED: &str = "Voice recognition is not enabled";

/// A profile keeps at most this many example embeddings (the newest).
pub const MAX_EXEMPLARS: usize = 20;

/// Without a `profile_id`, a new embedding joins an existing profile of the
/// same name only if it is at least this similar to it; otherwise it is
/// taken for a different person of the same name and gets its own profile.
pub const SAME_NAME_MIN_SIMILARITY: f32 = 0.30;

pub const MAX_NAME_CHARS: usize = 120;

const VERSION: u32 = 1;
const EXTENSION: &str = "json";
const QUARANTINE_MARK: &str = ".corrupt-";

pub fn require_consent(consent: bool) -> Result<(), String> {
    if consent {
        Ok(())
    } else {
        Err(CONSENT_REQUIRED.to_string())
    }
}

/// `~/.notesage/voice-profiles/`.
pub fn default_profiles_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".notesage")
        .join("voice-profiles")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    /// The user named a speaker in a recording.
    Manual,
    /// Learned from the named turns of a Teams transcript.
    Teams,
    /// The user enrolled their own voice.
    Enrolment,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProfileSource {
    pub kind: SourceKind,
    /// The recording the voice came from (bundle path), if any.
    #[serde(default)]
    pub recording: Option<String>,
    /// RFC 3339.
    pub at: String,
}

/// One person, as stored on disk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VoiceProfile {
    pub version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_me: bool,
    pub created_at: String,
    pub updated_at: String,
    pub sources: Vec<ProfileSource>,
    /// The voice model the embeddings belong to.
    pub model: String,
    /// Example embeddings, oldest first, each normalised.
    pub embeddings: Vec<Vec<f32>>,
    /// Normalised mean of `embeddings`.
    pub centroid: Vec<f32>,
}

/// A profile as the frontend sees it: no embeddings.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub is_me: bool,
    pub created_at: String,
    pub updated_at: String,
    pub sources: Vec<ProfileSource>,
    pub model: String,
    pub exemplar_count: usize,
    /// False when the profile was made with another voice model: it is kept
    /// but cannot be matched until the person's voice is saved again.
    pub usable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProfileList {
    pub profiles: Vec<ProfileSummary>,
    /// Profile files that could not be read and were moved aside.
    pub quarantined: usize,
    /// The folder the profiles are in, to show the user where their data is.
    pub directory: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SaveOutcome {
    pub profile: ProfileSummary,
    /// True when a new person was created, false when an existing profile
    /// got another example.
    pub created: bool,
}

pub struct ProfileStore {
    dir: PathBuf,
    /// The model in use now.
    model: String,
}

fn restrict(path: &Path, mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    {
        let _ = (path, mode);
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Names are compared without case and surrounding or repeated spaces.
pub fn normalize_name(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn clean_name(name: &str) -> Result<String, String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err("A voice profile needs a name".into());
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("The name is too long (at most {MAX_NAME_CHARS} characters)"));
    }
    Ok(name)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

impl VoiceProfile {
    fn summary(&self, current_model: &str) -> ProfileSummary {
        ProfileSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            is_me: self.is_me,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            sources: self.sources.clone(),
            model: self.model.clone(),
            exemplar_count: self.embeddings.len(),
            usable: self.model == current_model && !self.centroid.is_empty(),
        }
    }

    fn recompute(&mut self) {
        if self.embeddings.len() > MAX_EXEMPLARS {
            let drop = self.embeddings.len() - MAX_EXEMPLARS;
            self.embeddings.drain(..drop);
        }
        self.centroid =
            mean_normalized(self.embeddings.iter().map(|v| v.as_slice())).unwrap_or_default();
    }

    /// Whether what was read from disk is internally sound.
    fn is_sound(&self) -> bool {
        valid_id(&self.id)
            && !self.embeddings.is_empty()
            && !self.centroid.is_empty()
            && self
                .embeddings
                .iter()
                .all(|e| e.len() == self.centroid.len() && e.iter().all(|x| x.is_finite()))
            && self.centroid.iter().all(|x| x.is_finite())
    }
}

impl ProfileStore {
    pub fn new(dir: PathBuf, model: &str) -> Self {
        Self { dir, model: model.to_string() }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn ensure_dir(&self) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir)
            .map_err(|e| format!("Could not create {}: {e}", self.dir.display()))?;
        restrict(&self.dir, 0o700);
        Ok(())
    }

    fn path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.{EXTENSION}"))
    }

    /// Write `profile` so that a crash leaves either the old file or the new
    /// one, never half of one.
    fn write(&self, profile: &VoiceProfile) -> Result<(), String> {
        self.ensure_dir()?;
        let json = serde_json::to_vec(profile).map_err(|e| format!("Could not encode the voice profile: {e}"))?;
        let tmp = self.dir.join(format!(".{}.tmp-{}", profile.id, std::process::id()));
        let result = (|| -> std::io::Result<()> {
            use std::io::Write;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&tmp)?;
            file.write_all(&json)?;
            file.sync_all()?;
            Ok(())
        })();
        if let Err(e) = result {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("Could not save the voice profile: {e}"));
        }
        restrict(&tmp, 0o600);
        std::fs::rename(&tmp, self.path(&profile.id)).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("Could not save the voice profile: {e}")
        })
    }

    /// Move a file that cannot be read out of the way, keeping its bytes.
    fn quarantine(&self, path: &Path) {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("profile");
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S");
        let mut target = self.dir.join(format!("{name}{QUARANTINE_MARK}{stamp}"));
        let mut n = 1;
        while target.exists() {
            n += 1;
            target = self.dir.join(format!("{name}{QUARANTINE_MARK}{stamp}-{n}"));
        }
        match std::fs::rename(path, &target) {
            Ok(()) => {
                restrict(&target, 0o600);
                log::warn!(target: "notesage::speakers", "Unreadable voice profile moved aside: {}", target.display());
            }
            Err(e) => log::warn!(target: "notesage::speakers", "Unreadable voice profile {} could not be moved aside: {e}", path.display()),
        }
    }

    fn quarantined_count(&self) -> usize {
        std::fs::read_dir(&self.dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|e| e.file_name().to_string_lossy().contains(QUARANTINE_MARK))
                    .count()
            })
            .unwrap_or(0)
    }

    /// Every readable profile, oldest first. Unreadable files are moved
    /// aside.
    pub fn load_all(&self) -> Vec<VoiceProfile> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return Vec::new() };
        let mut out = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.')
                || name.contains(QUARANTINE_MARK)
                || path.extension().and_then(|e| e.to_str()) != Some(EXTENSION)
                || !path.is_file()
            {
                continue;
            }
            let parsed = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<VoiceProfile>(&bytes).ok())
                .filter(|p| p.is_sound() && name == format!("{}.{EXTENSION}", p.id));
            match parsed {
                Some(p) => out.push(p),
                None => self.quarantine(&path),
            }
        }
        out.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        out
    }

    fn load(&self, id: &str) -> Result<VoiceProfile, String> {
        if !valid_id(id) {
            return Err(format!("Voice profile not found: {id}"));
        }
        self.load_all().into_iter().find(|p| p.id == id).ok_or_else(|| format!("Voice profile not found: {id}"))
    }

    pub fn list(&self) -> ProfileList {
        let profiles = self.load_all().iter().map(|p| p.summary(&self.model)).collect();
        ProfileList {
            profiles,
            quarantined: self.quarantined_count(),
            directory: self.dir.to_string_lossy().to_string(),
        }
    }

    /// Profiles that can be matched: made with the current model.
    pub fn usable(&self) -> Vec<VoiceProfile> {
        self.load_all().into_iter().filter(|p| p.model == self.model && !p.centroid.is_empty()).collect()
    }

    fn check_embedding(&self, embedding: Vec<f32>, dim: usize) -> Result<Vec<f32>, String> {
        if embedding.len() != dim {
            return Err(format!(
                "The voice embedding has {} values; the voice model in use gives {dim}",
                embedding.len()
            ));
        }
        normalized(embedding)
    }

    /// Add a voice example for a person.
    ///
    /// - `profile_id` given: that profile gets the example (and the name, if
    ///   it differs).
    /// - otherwise an existing profile with the same name gets it, provided
    ///   the voice is not clearly someone else's; else a new profile is made.
    ///
    /// A profile made with another model starts over with this example.
    #[allow(clippy::too_many_arguments)]
    pub fn save(
        &self,
        consent: bool,
        name: &str,
        embedding: Vec<f32>,
        dim: usize,
        kind: SourceKind,
        recording: Option<String>,
        profile_id: Option<&str>,
        is_me: bool,
    ) -> Result<SaveOutcome, String> {
        require_consent(consent)?;
        let embedding = self.check_embedding(embedding, dim)?;
        let source = ProfileSource { kind, recording, at: now() };

        let existing = match profile_id {
            Some(id) => Some(self.load(id)?),
            None if is_me => self.load_all().into_iter().find(|p| p.is_me),
            None => {
                let wanted = normalize_name(&clean_name(name)?);
                self.load_all().into_iter().find(|p| {
                    !p.is_me
                        && normalize_name(&p.name) == wanted
                        && (p.model != self.model || cosine(&p.centroid, &embedding) >= SAME_NAME_MIN_SIMILARITY)
                })
            }
        };

        let (mut profile, created) = match existing {
            Some(mut p) => {
                if p.model != self.model {
                    // Embeddings of another model cannot be mixed in.
                    p.embeddings.clear();
                    p.model = self.model.clone();
                }
                if !name.trim().is_empty() {
                    p.name = clean_name(name)?;
                }
                (p, false)
            }
            None => {
                let at = now();
                (
                    VoiceProfile {
                        version: VERSION,
                        id: uuid::Uuid::new_v4().to_string(),
                        name: clean_name(name)?,
                        is_me,
                        created_at: at.clone(),
                        updated_at: at,
                        sources: Vec::new(),
                        model: self.model.clone(),
                        embeddings: Vec::new(),
                        centroid: Vec::new(),
                    },
                    true,
                )
            }
        };
        if is_me {
            // Only one profile is the user.
            for mut other in self.load_all().into_iter().filter(|p| p.is_me && p.id != profile.id) {
                other.is_me = false;
                self.write(&other)?;
            }
            profile.is_me = true;
        }
        profile.embeddings.push(embedding);
        profile.sources.push(source);
        if profile.sources.len() > 100 {
            let drop = profile.sources.len() - 100;
            profile.sources.drain(..drop);
        }
        profile.updated_at = now();
        profile.recompute();
        self.write(&profile)?;
        Ok(SaveOutcome { profile: profile.summary(&self.model), created })
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<ProfileSummary, String> {
        let mut profile = self.load(id)?;
        profile.name = clean_name(name)?;
        profile.updated_at = now();
        self.write(&profile)?;
        Ok(profile.summary(&self.model))
    }

    /// Fold `from` into `into` (they are the same person) and delete `from`.
    /// `into` keeps its name.
    pub fn merge(&self, into_id: &str, from_id: &str) -> Result<ProfileSummary, String> {
        if into_id == from_id {
            return Err("Cannot merge a voice profile with itself".into());
        }
        let mut into = self.load(into_id)?;
        let from = self.load(from_id)?;
        if into.model == from.model {
            // Interleave by keeping the newest MAX_EXEMPLARS of both.
            into.embeddings.extend(from.embeddings);
        } else if from.model == self.model {
            // Only the one made with the current model is worth keeping.
            into.embeddings = from.embeddings;
            into.model = from.model;
        }
        into.sources.extend(from.sources);
        into.sources.sort_by(|a, b| a.at.cmp(&b.at));
        into.is_me = into.is_me || from.is_me;
        into.created_at = into.created_at.min(from.created_at);
        into.updated_at = now();
        into.recompute();
        // Write the survivor first: if the delete fails, nothing is lost.
        self.write(&into)?;
        std::fs::remove_file(self.path(from_id))
            .map_err(|e| format!("Merged, but could not delete the old profile: {e}"))?;
        Ok(into.summary(&self.model))
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let profile = self.load(id)?;
        std::fs::remove_file(self.path(&profile.id)).map_err(|e| format!("Could not delete the voice profile: {e}"))
    }

    /// Remove every voice profile, including files that were moved aside and
    /// leftovers of interrupted writes, and the folder itself. Returns how
    /// many files were removed. Files that are not this app's stay (and then
    /// so does the folder).
    pub fn delete_all(&self) -> Result<usize, String> {
        let entries = match std::fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(format!("Could not read {}: {e}", self.dir.display())),
        };
        let mut removed = 0;
        let mut failed: Option<String> = None;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let ours = name.ends_with(&format!(".{EXTENSION}"))
                || name.contains(QUARANTINE_MARK)
                || (name.starts_with('.') && name.contains(".tmp-"));
            if !ours || !entry.path().is_file() {
                continue;
            }
            match std::fs::remove_file(entry.path()) {
                Ok(()) => removed += 1,
                Err(e) => failed = Some(format!("Could not delete {}: {e}", entry.path().display())),
            }
        }
        if let Some(e) = failed {
            return Err(e);
        }
        // Only succeeds when the folder is empty.
        let _ = std::fs::remove_dir(&self.dir);
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::speakers::cluster::testing::{near, voice, Rng};

    const MODEL: &str = "model-a";
    const DIM: usize = 16;

    fn store(tag: &str) -> ProfileStore {
        let dir = std::env::temp_dir()
            .join(format!("notesage-voice-profiles-{tag}-{}", std::process::id()))
            .join("voice-profiles");
        let _ = std::fs::remove_dir_all(&dir);
        ProfileStore::new(dir, MODEL)
    }

    fn cleanup(s: &ProfileStore) {
        let _ = std::fs::remove_dir_all(s.dir().parent().unwrap());
    }

    fn save(s: &ProfileStore, name: &str, v: &[f32], id: Option<&str>) -> SaveOutcome {
        s.save(true, name, v.to_vec(), DIM, SourceKind::Manual, Some("/lib/Recordings/A".into()), id, false).unwrap()
    }

    #[cfg(unix)]
    fn mode(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn nothing_is_created_without_consent() {
        let s = store("consent");
        let mut rng = Rng(1);
        let v = voice(&mut rng, DIM);
        let err = s.save(false, "Anna", v, DIM, SourceKind::Manual, None, None, false).unwrap_err();
        assert_eq!(err, CONSENT_REQUIRED);
        assert!(!s.dir().exists(), "no folder may appear without consent");
        assert_eq!(require_consent(true), Ok(()));
        cleanup(&s);
    }

    #[test]
    fn a_saved_profile_is_private_and_listed_without_embeddings() {
        let s = store("save");
        let mut rng = Rng(2);
        let v = voice(&mut rng, DIM);
        let out = save(&s, "  Anna   Berg ", &v, None);
        assert!(out.created);
        assert_eq!(out.profile.name, "Anna Berg");
        assert_eq!(out.profile.exemplar_count, 1);
        assert!(out.profile.usable);
        assert!(!out.profile.is_me);
        assert_eq!(out.profile.sources.len(), 1);
        assert_eq!(out.profile.sources[0].kind, SourceKind::Manual);
        assert_eq!(out.profile.sources[0].recording.as_deref(), Some("/lib/Recordings/A"));

        #[cfg(unix)]
        {
            assert_eq!(mode(s.dir()), 0o700);
            assert_eq!(mode(&s.path(&out.profile.id)), 0o600);
        }
        // No temp file is left behind.
        let names: Vec<String> =
            std::fs::read_dir(s.dir()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec![format!("{}.json", out.profile.id)]);

        let list = s.list();
        assert_eq!(list.profiles.len(), 1);
        assert_eq!(list.quarantined, 0);
        assert_eq!(list.directory, s.dir().to_string_lossy());
        // What crosses IPC holds no voiceprint.
        let json = serde_json::to_string(&list).unwrap();
        assert!(!json.contains("embeddings") && !json.contains("centroid"), "{json}");
        for key in ["\"id\"", "\"name\"", "\"is_me\"", "\"created_at\"", "\"updated_at\"", "\"sources\"", "\"model\"", "\"exemplar_count\"", "\"usable\"", "\"kind\":\"manual\""] {
            assert!(json.contains(key), "missing {key} in {json}");
        }
        cleanup(&s);
    }

    #[test]
    fn examples_accumulate_and_the_centroid_follows() {
        let s = store("append");
        let mut rng = Rng(3);
        let v = voice(&mut rng, DIM);
        let first = save(&s, "Anna", &near(&mut rng, &v, 0.3), None);
        // By id.
        let second = save(&s, "", &near(&mut rng, &v, 0.3), Some(&first.profile.id));
        assert!(!second.created);
        assert_eq!(second.profile.name, "Anna");
        assert_eq!(second.profile.exemplar_count, 2);
        // By name, whatever the case and spacing.
        let third = save(&s, " anna ", &near(&mut rng, &v, 0.3), None);
        assert!(!third.created);
        assert_eq!(third.profile.id, first.profile.id);
        assert_eq!(third.profile.exemplar_count, 3);
        let p = &s.load_all()[0];
        assert!(cosine(&p.centroid, &v) > 0.9);
        assert!((p.centroid.iter().map(|x| x * x).sum::<f32>().sqrt() - 1.0).abs() < 1e-4);
        // Only the newest MAX_EXEMPLARS are kept.
        for _ in 0..MAX_EXEMPLARS + 5 {
            save(&s, "", &near(&mut rng, &v, 0.3), Some(&first.profile.id));
        }
        assert_eq!(s.load_all()[0].embeddings.len(), MAX_EXEMPLARS);
        assert_eq!(s.list().profiles.len(), 1);
        cleanup(&s);
    }

    #[test]
    fn a_different_voice_with_the_same_name_gets_its_own_profile() {
        let s = store("samename");
        let mut rng = Rng(4);
        let (a, b) = (voice(&mut rng, DIM), voice(&mut rng, DIM));
        assert!(cosine(&a, &b) < SAME_NAME_MIN_SIMILARITY);
        let first = save(&s, "Anna", &a, None);
        let second = save(&s, "Anna", &b, None);
        assert!(second.created);
        assert_ne!(first.profile.id, second.profile.id);
        assert_eq!(s.list().profiles.len(), 2);
        // The first is untouched.
        assert_eq!(s.load(&first.profile.id).unwrap().embeddings, vec![a]);
        cleanup(&s);
    }

    #[test]
    fn bad_input_is_refused() {
        let s = store("bad");
        let mut rng = Rng(5);
        let v = voice(&mut rng, DIM);
        let save = |name: &str, e: Vec<f32>, id: Option<&str>| {
            s.save(true, name, e, DIM, SourceKind::Manual, None, id, false)
        };
        assert_eq!(save("", v.clone(), None).unwrap_err(), "A voice profile needs a name");
        assert!(save(&"x".repeat(MAX_NAME_CHARS + 1), v.clone(), None).unwrap_err().starts_with("The name is too long"));
        assert!(save("Anna", vec![0.5; DIM - 1], None).unwrap_err().starts_with("The voice embedding has 15 values"));
        assert!(save("Anna", vec![0.0; DIM], None).is_err());
        assert!(save("Anna", vec![f32::NAN; DIM], None).is_err());
        assert_eq!(save("Anna", v.clone(), Some("no-such-id")).unwrap_err(), "Voice profile not found: no-such-id");
        // An id is never used as a path.
        assert!(save("Anna", v.clone(), Some("../../etc/passwd")).unwrap_err().starts_with("Voice profile not found"));
        assert!(s.delete("../x").is_err());
        assert!(s.list().profiles.is_empty());
        cleanup(&s);
    }

    #[test]
    fn rename_merge_delete() {
        let s = store("ops");
        let mut rng = Rng(6);
        let v = voice(&mut rng, DIM);
        let other = voice(&mut rng, DIM);
        let a = save(&s, "Speaker from Monday", &near(&mut rng, &v, 0.2), None).profile;
        let b = save(&s, "Anna", &near(&mut rng, &v, 0.2), None).profile;
        let c = save(&s, "Björn", &other, None).profile;

        let renamed = s.rename(&c.id, " Björn  Ek ").unwrap();
        assert_eq!(renamed.name, "Björn Ek");
        assert_eq!(s.rename(&c.id, " ").unwrap_err(), "A voice profile needs a name");
        assert!(s.rename("missing", "x").is_err());

        let merged = s.merge(&b.id, &a.id).unwrap();
        assert_eq!(merged.name, "Anna");
        assert_eq!(merged.exemplar_count, 2);
        assert_eq!(merged.sources.len(), 2);
        assert_eq!(merged.created_at, a.created_at.clone().min(b.created_at.clone()));
        assert!(!s.path(&a.id).exists());
        assert_eq!(s.list().profiles.len(), 2);
        assert_eq!(s.merge(&b.id, &b.id).unwrap_err(), "Cannot merge a voice profile with itself");
        assert!(s.merge(&b.id, "missing").is_err());

        s.delete(&b.id).unwrap();
        assert!(!s.path(&b.id).exists());
        assert!(s.delete(&b.id).is_err());
        assert_eq!(s.list().profiles.len(), 1);
        cleanup(&s);
    }

    #[test]
    fn only_one_profile_is_me() {
        let s = store("me");
        let mut rng = Rng(7);
        let v = voice(&mut rng, DIM);
        let me = |e: Vec<f32>, name: &str| {
            s.save(true, name, e, DIM, SourceKind::Enrolment, None, None, true).unwrap()
        };
        let first = me(near(&mut rng, &v, 0.2), "Me");
        assert!(first.created && first.profile.is_me);
        // Enrolling again adds to the same profile, even under another name.
        let again = me(near(&mut rng, &v, 0.2), "Peter");
        assert!(!again.created);
        assert_eq!(again.profile.id, first.profile.id);
        assert_eq!(again.profile.name, "Peter");
        assert_eq!(again.profile.exemplar_count, 2);
        // Marking another profile as me takes the mark from the first.
        let other = save(&s, "Someone", &voice(&mut rng, DIM), None).profile;
        let marked = s
            .save(true, "", near(&mut rng, &v, 0.2), DIM, SourceKind::Manual, None, Some(&other.id), true)
            .unwrap();
        assert!(marked.profile.is_me);
        let list = s.list();
        assert_eq!(list.profiles.iter().filter(|p| p.is_me).count(), 1);
        // A saved name never silently lands in the "me" profile.
        let named = save(&s, "Someone", &v, None);
        assert_ne!(named.profile.is_me, true);
        cleanup(&s);
    }

    #[test]
    fn a_corrupted_file_is_moved_aside_and_nothing_else_is_lost() {
        let s = store("corrupt");
        let mut rng = Rng(8);
        let good = save(&s, "Anna", &voice(&mut rng, DIM), None).profile;
        let garbage = b"{ this is not json";
        std::fs::write(s.dir().join("broken.json"), garbage).unwrap();
        // Valid JSON, wrong shape; and a profile whose id is not its file name.
        std::fs::write(s.dir().join("shape.json"), b"{\"id\": 3}").unwrap();
        let mut liar = s.load(&good.id).unwrap();
        liar.id = "someone-else".into();
        std::fs::write(s.dir().join("liar.json"), serde_json::to_vec(&liar).unwrap()).unwrap();
        // NaN cannot be written as JSON, so an unsound profile is made by
        // emptying the centroid.
        let mut unsound = s.load(&good.id).unwrap();
        unsound.id = "unsound".into();
        unsound.centroid.clear();
        std::fs::write(s.dir().join("unsound.json"), serde_json::to_vec(&unsound).unwrap()).unwrap();

        let list = s.list();
        assert_eq!(list.profiles.len(), 1);
        assert_eq!(list.profiles[0].id, good.id);
        assert_eq!(list.quarantined, 4);
        // The bytes are still there, under another name.
        let kept: Vec<std::path::PathBuf> = std::fs::read_dir(s.dir())
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("broken.json.corrupt-"))
            .collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(std::fs::read(&kept[0]).unwrap(), garbage);
        // Listing again does not quarantine anything twice, and saving works.
        assert_eq!(s.list().quarantined, 4);
        save(&s, "Björn", &voice(&mut rng, DIM), None);
        assert_eq!(s.list().profiles.len(), 2);
        cleanup(&s);
    }

    #[test]
    fn profiles_of_another_model_are_listed_but_not_usable_and_start_over_when_saved() {
        let old = store("model");
        let mut rng = Rng(9);
        let v = voice(&mut rng, DIM);
        let saved = save(&old, "Anna", &v, None).profile;
        // The app now uses another model (with another embedding size).
        let new = ProfileStore::new(old.dir().to_path_buf(), "model-b");
        let list = new.list();
        assert_eq!(list.profiles.len(), 1);
        assert!(!list.profiles[0].usable);
        assert_eq!(list.profiles[0].model, MODEL);
        assert!(new.usable().is_empty());
        // Saving the person's voice again replaces the old examples.
        let fresh: Vec<f32> = normalized(vec![1.0; 8]).unwrap();
        let out = new.save(true, "Anna", fresh.clone(), 8, SourceKind::Manual, None, None, false).unwrap();
        assert!(!out.created);
        assert_eq!(out.profile.id, saved.id);
        assert!(out.profile.usable);
        assert_eq!(out.profile.model, "model-b");
        assert_eq!(new.load(&saved.id).unwrap().embeddings, vec![fresh]);
        assert_eq!(out.profile.sources.len(), 2);
        cleanup(&old);
    }

    #[test]
    fn delete_all_removes_every_trace() {
        let s = store("deleteall");
        assert_eq!(s.delete_all().unwrap(), 0); // nothing there yet
        let mut rng = Rng(10);
        save(&s, "Anna", &voice(&mut rng, DIM), None);
        save(&s, "Björn", &voice(&mut rng, DIM), None);
        std::fs::write(s.dir().join("broken.json"), b"x").unwrap();
        assert_eq!(s.list().quarantined, 1);
        std::fs::write(s.dir().join(".abc.tmp-123"), b"half written").unwrap();
        assert_eq!(s.delete_all().unwrap(), 4);
        assert!(!s.dir().exists(), "the folder itself is gone");
        assert!(s.list().profiles.is_empty());

        // A file that is not ours is left alone (and so the folder stays).
        save(&s, "Anna", &voice(&mut rng, DIM), None);
        std::fs::write(s.dir().join("notes.txt"), b"mine").unwrap();
        assert_eq!(s.delete_all().unwrap(), 1);
        assert!(s.dir().join("notes.txt").exists());
        cleanup(&s);
    }

    #[test]
    fn the_stored_file_has_the_documented_shape() {
        let s = store("shape");
        let mut rng = Rng(11);
        let out = save(&s, "Anna", &voice(&mut rng, DIM), None);
        let json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(s.path(&out.profile.id)).unwrap()).unwrap();
        for key in ["version", "id", "name", "is_me", "created_at", "updated_at", "sources", "model", "embeddings", "centroid"] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
        assert_eq!(json["sources"][0]["kind"], "manual");
        assert_eq!(json["embeddings"][0].as_array().unwrap().len(), DIM);
        assert_eq!(serde_json::to_string(&SourceKind::Enrolment).unwrap(), "\"enrolment\"");
        assert_eq!(serde_json::to_string(&SourceKind::Teams).unwrap(), "\"teams\"");
        cleanup(&s);
    }
}
