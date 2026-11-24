//! File access used by the indexer, behind a trait so tests can count reads
//! and simulate iCloud "dataless" (evicted) files on any platform.

use std::path::Path;
use std::time::UNIX_EPOCH;

/// `SF_DATALESS` from `<sys/stat.h>`: the file's content is not on disk (an
/// evicted iCloud file). Reading such a file blocks until it is downloaded.
/// Defined here because the `libc` version in the lockfile does not export it.
#[cfg(target_os = "macos")]
const SF_DATALESS: u32 = 0x4000_0000;

/// What the indexer needs to know about a file before deciding to read it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FileStat {
    /// Modification time, nanoseconds since the unix epoch.
    pub mtime_ns: i64,
    /// Size in bytes.
    pub size: i64,
    /// True when the content is not local (see [`SF_DATALESS`]). A dataless
    /// file must not be read: that would download it.
    pub dataless: bool,
}

/// The two filesystem operations the indexer performs on a document.
pub(crate) trait FileAccess: Sync {
    /// Metadata only. Must never trigger a download.
    fn stat(&self, path: &Path) -> std::io::Result<FileStat>;
    /// Whole-file read.
    fn read(&self, path: &Path) -> std::io::Result<String>;
}

/// The real filesystem.
pub(crate) struct RealFs;

impl FileAccess for RealFs {
    fn stat(&self, path: &Path) -> std::io::Result<FileStat> {
        stat_with(path, is_dataless)
    }

    fn read(&self, path: &Path) -> std::io::Result<String> {
        std::fs::read_to_string(path)
    }
}

/// `stat` a path, deciding "dataless" with the given predicate. Tests pass
/// their own predicate; production passes [`is_dataless`].
pub(crate) fn stat_with(
    path: &Path,
    dataless: impl Fn(&std::fs::Metadata) -> bool,
) -> std::io::Result<FileStat> {
    let meta = std::fs::metadata(path)?;
    let mtime_ns = match meta.modified()?.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_nanos() as i64,
        // Before the epoch: keep it distinct and stable rather than failing.
        Err(e) => -(e.duration().as_nanos() as i64),
    };
    Ok(FileStat {
        mtime_ns,
        size: meta.len() as i64,
        dataless: dataless(&meta),
    })
}

/// True when the file's content is not on this machine (macOS only).
#[cfg(target_os = "macos")]
pub(crate) fn is_dataless(meta: &std::fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    meta.st_flags() & SF_DATALESS != 0
}

/// Other platforms have no dataless files.
#[cfg(not(target_os = "macos"))]
pub(crate) fn is_dataless(_meta: &std::fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stat_reports_size_and_mtime_and_uses_the_injected_predicate() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        std::fs::write(&file, "hello").unwrap();

        let local = stat_with(&file, |_| false).unwrap();
        assert_eq!(local.size, 5);
        assert!(local.mtime_ns > 0);
        assert!(!local.dataless);

        let evicted = stat_with(&file, |_| true).unwrap();
        assert!(evicted.dataless);
        assert_eq!(evicted.mtime_ns, local.mtime_ns);
    }

    #[test]
    fn a_local_file_is_not_dataless_on_the_real_filesystem() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        std::fs::write(&file, "hello").unwrap();
        assert!(!RealFs.stat(&file).unwrap().dataless);
        assert_eq!(RealFs.read(&file).unwrap(), "hello");
    }

    #[test]
    fn stat_of_a_missing_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(RealFs.stat(&dir.path().join("nope.md")).is_err());
    }
}
