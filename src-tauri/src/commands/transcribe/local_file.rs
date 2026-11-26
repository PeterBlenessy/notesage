//! Making sure an audio file is actually on this Mac before reading it.
//!
//! iCloud can evict a file's content while leaving the file in place: it
//! still exists and still reports its full size ("dataless"). Opening it then
//! blocks until iCloud has downloaded it again, which can be minutes, or
//! never when offline. Older systems instead replace the file with a
//! `.name.icloud` placeholder. Both are handled here: ask for the download,
//! then wait for it with a limit, without ever reading the file.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// How long to wait for iCloud to deliver a file before giving up.
pub const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// How often to look whether it has arrived.
pub const DOWNLOAD_POLL: Duration = Duration::from_millis(500);

/// What `stat` says about a path, without touching its content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Meta {
    pub is_file: bool,
    pub size: u64,
    /// Content is in iCloud, not on disk.
    pub dataless: bool,
}

/// The filesystem and iCloud calls, behind a trait so the waiting logic can
/// be tested without either.
pub trait FileProbe {
    /// `None` when the path does not exist. Must never read content.
    fn meta(&self, path: &Path) -> Option<Meta>;
    /// Whether a `.name.icloud` placeholder exists beside the path.
    fn placeholder_exists(&self, path: &Path) -> bool;
    /// Ask iCloud to download the file. Returns once the request is made.
    fn request_download(&self, path: &Path) -> Result<(), String>;
    fn sleep(&self, duration: Duration);
}

/// The real filesystem.
pub struct RealProbe;

impl FileProbe for RealProbe {
    fn meta(&self, path: &Path) -> Option<Meta> {
        let meta = std::fs::metadata(path).ok()?;
        Some(Meta {
            is_file: meta.is_file(),
            size: meta.len(),
            dataless: crate::commands::sync::is_dataless(&meta),
        })
    }

    fn placeholder_exists(&self, path: &Path) -> bool {
        crate::commands::sync::icloud_placeholder_path(path).map(|p| p.exists()).unwrap_or(false)
    }

    fn request_download(&self, path: &Path) -> Result<(), String> {
        crate::commands::sync::request_icloud_download(path)
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locality {
    /// Content is on disk.
    Local,
    /// The file is in iCloud and can be asked for.
    Evicted,
    Missing,
}

pub fn locality(probe: &dyn FileProbe, path: &Path) -> Locality {
    match probe.meta(path) {
        Some(m) if m.dataless => Locality::Evicted,
        Some(_) => Locality::Local,
        None if probe.placeholder_exists(path) => Locality::Evicted,
        None => Locality::Missing,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnsureError {
    Missing,
    Cancelled,
    /// iCloud refused the request or did not deliver in time. The text is
    /// for the user.
    Download(String),
}

/// Return once `path` is on disk. Blocks (call it from a blocking task) for
/// at most `timeout`; `cancel` ends the wait early.
pub fn ensure_local(
    probe: &dyn FileProbe,
    path: &Path,
    timeout: Duration,
    poll: Duration,
    cancel: &AtomicBool,
) -> Result<(), EnsureError> {
    match locality(probe, path) {
        Locality::Local => return Ok(()),
        Locality::Missing => return Err(EnsureError::Missing),
        Locality::Evicted => {}
    }
    probe.request_download(path).map_err(EnsureError::Download)?;

    let poll = poll.max(Duration::from_millis(1));
    let mut waited = Duration::ZERO;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(EnsureError::Cancelled);
        }
        match locality(probe, path) {
            Locality::Local => return Ok(()),
            // Neither the file nor its placeholder: it was deleted meanwhile.
            Locality::Missing => return Err(EnsureError::Missing),
            Locality::Evicted => {}
        }
        if waited >= timeout {
            return Err(EnsureError::Download(format!(
                "it did not arrive within {}. Check the internet connection and try again",
                describe(timeout)
            )));
        }
        probe.sleep(poll);
        waited += poll;
    }
}

fn describe(d: Duration) -> String {
    let secs = d.as_secs();
    if secs >= 120 {
        format!("{} minutes", secs / 60)
    } else {
        format!("{secs} seconds")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::path::PathBuf;

    /// A file that becomes local after a set number of polls (or never).
    struct Fake {
        state: Cell<Locality>,
        arrives_after: Option<u32>,
        vanishes_after: Option<u32>,
        refuse: Option<String>,
        sleeps: Cell<u32>,
        requests: RefCell<Vec<PathBuf>>,
        cancel_after: Option<(u32, &'static AtomicBool)>,
    }

    impl Fake {
        fn new(state: Locality) -> Self {
            Self {
                state: Cell::new(state),
                arrives_after: None,
                vanishes_after: None,
                refuse: None,
                sleeps: Cell::new(0),
                requests: RefCell::new(Vec::new()),
                cancel_after: None,
            }
        }
    }

    impl FileProbe for Fake {
        fn meta(&self, _path: &Path) -> Option<Meta> {
            match self.state.get() {
                Locality::Local => Some(Meta { is_file: true, size: 1000, dataless: false }),
                // The modern shape: present, full size, no content.
                Locality::Evicted => Some(Meta { is_file: true, size: 1000, dataless: true }),
                Locality::Missing => None,
            }
        }

        fn placeholder_exists(&self, _path: &Path) -> bool {
            false
        }

        fn request_download(&self, path: &Path) -> Result<(), String> {
            self.requests.borrow_mut().push(path.to_path_buf());
            match &self.refuse {
                Some(e) => Err(e.clone()),
                None => Ok(()),
            }
        }

        fn sleep(&self, _duration: Duration) {
            let n = self.sleeps.get() + 1;
            self.sleeps.set(n);
            if self.arrives_after == Some(n) {
                self.state.set(Locality::Local);
            }
            if self.vanishes_after == Some(n) {
                self.state.set(Locality::Missing);
            }
            if let Some((at, flag)) = self.cancel_after {
                if at == n {
                    flag.store(true, Ordering::Relaxed);
                }
            }
        }
    }

    const SEC: Duration = Duration::from_secs(1);
    fn no_cancel() -> AtomicBool {
        AtomicBool::new(false)
    }

    #[test]
    fn a_local_file_needs_nothing() {
        let fake = Fake::new(Locality::Local);
        assert_eq!(ensure_local(&fake, Path::new("/a.m4a"), 10 * SEC, SEC, &no_cancel()), Ok(()));
        assert!(fake.requests.borrow().is_empty());
        assert_eq!(fake.sleeps.get(), 0);
    }

    #[test]
    fn a_missing_file_is_missing_not_a_download() {
        let fake = Fake::new(Locality::Missing);
        assert_eq!(
            ensure_local(&fake, Path::new("/a.m4a"), 10 * SEC, SEC, &no_cancel()),
            Err(EnsureError::Missing)
        );
        assert!(fake.requests.borrow().is_empty());
    }

    /// The case the old size gate missed: the file exists at full size, so it
    /// looked ready, and the decoder then blocked on it.
    #[test]
    fn a_dataless_file_is_requested_and_waited_for() {
        let mut fake = Fake::new(Locality::Evicted);
        fake.arrives_after = Some(3);
        assert_eq!(ensure_local(&fake, Path::new("/a.m4a"), 10 * SEC, SEC, &no_cancel()), Ok(()));
        assert_eq!(*fake.requests.borrow(), vec![PathBuf::from("/a.m4a")]);
        assert_eq!(fake.sleeps.get(), 3);
    }

    #[test]
    fn offline_gives_up_after_the_timeout_with_a_message_for_the_user() {
        let fake = Fake::new(Locality::Evicted);
        let err = ensure_local(&fake, Path::new("/a.m4a"), 10 * SEC, SEC, &no_cancel()).unwrap_err();
        assert_eq!(fake.sleeps.get(), 10, "must wait the timeout, no longer");
        match err {
            EnsureError::Download(msg) => {
                assert!(msg.contains("10 seconds"), "{msg}");
                assert!(msg.contains("internet connection"), "{msg}");
            }
            other => panic!("expected a download error, got {other:?}"),
        }
        assert!(describe(DOWNLOAD_TIMEOUT).contains("5 minutes"));
    }

    #[test]
    fn a_refused_request_fails_at_once() {
        let mut fake = Fake::new(Locality::Evicted);
        fake.refuse = Some("iCloud is turned off".into());
        assert_eq!(
            ensure_local(&fake, Path::new("/a.m4a"), 10 * SEC, SEC, &no_cancel()),
            Err(EnsureError::Download("iCloud is turned off".into()))
        );
        assert_eq!(fake.sleeps.get(), 0);
    }

    #[test]
    fn cancelling_ends_the_wait() {
        static FLAG: AtomicBool = AtomicBool::new(false);
        let mut fake = Fake::new(Locality::Evicted);
        fake.cancel_after = Some((2, &FLAG));
        assert_eq!(
            ensure_local(&fake, Path::new("/a.m4a"), 100 * SEC, SEC, &FLAG),
            Err(EnsureError::Cancelled)
        );
        assert_eq!(fake.sleeps.get(), 2);
    }

    #[test]
    fn a_file_deleted_while_waiting_is_reported_missing() {
        let mut fake = Fake::new(Locality::Evicted);
        fake.vanishes_after = Some(1);
        assert_eq!(
            ensure_local(&fake, Path::new("/a.m4a"), 100 * SEC, SEC, &no_cancel()),
            Err(EnsureError::Missing)
        );
    }

    #[test]
    fn a_placeholder_beside_a_missing_file_counts_as_evicted() {
        struct Placeholder;
        impl FileProbe for Placeholder {
            fn meta(&self, _p: &Path) -> Option<Meta> {
                None
            }
            fn placeholder_exists(&self, _p: &Path) -> bool {
                true
            }
            fn request_download(&self, _p: &Path) -> Result<(), String> {
                Ok(())
            }
            fn sleep(&self, _d: Duration) {}
        }
        assert_eq!(locality(&Placeholder, Path::new("/a.m4a")), Locality::Evicted);
    }

    #[test]
    fn the_real_probe_sees_a_normal_file_as_local() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("audio.wav");
        std::fs::write(&file, b"abc").unwrap();
        assert_eq!(locality(&RealProbe, &file), Locality::Local);
        assert_eq!(RealProbe.meta(&file), Some(Meta { is_file: true, size: 3, dataless: false }));
        assert_eq!(locality(&RealProbe, &dir.path().join("nope.wav")), Locality::Missing);
        // The old placeholder shape.
        std::fs::write(dir.path().join(".gone.m4a.icloud"), b"").unwrap();
        assert_eq!(locality(&RealProbe, &dir.path().join("gone.m4a")), Locality::Evicted);
    }
}
