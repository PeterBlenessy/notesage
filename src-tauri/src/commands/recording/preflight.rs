//! What can be known before recording starts, without asking the user
//! anything (C5): microphone authorisation, whether this macOS can tap system
//! audio, and how much room the staging volume has.

use std::path::Path;

/// Parse the leading `major.minor` of an OS version string (`"14.2.1"`,
/// `"15.0"`, `"14"`).
pub fn parse_os_version(version: &str) -> Option<(u32, u32)> {
    let mut parts = version.trim().split('.');
    let major = parts.next()?.trim().parse().ok()?;
    let minor = match parts.next() {
        Some(m) => m.trim().parse().ok()?,
        None => 0,
    };
    Some((major, minor))
}

/// CoreAudio process taps (`AudioHardwareCreateProcessTap`, `CATapDescription`),
/// which cpal's loopback is built on, exist from macOS 14.2. On anything older
/// the symbols are absent and calling into them would crash, so this gate is
/// what keeps `start_recording("system")` safe there.
pub fn macos_supports_system_audio(version: (u32, u32)) -> bool {
    version >= (14, 2)
}

/// `"available" | "unsupported" | "unknown"`.
///
/// There is no `"denied"`: macOS offers no public way to read the "System
/// Audio Recording" permission. A denied tap delivers silence, which the
/// recorder reports as a `silence` warning on the system source.
pub fn system_audio_status() -> &'static str {
    if !cfg!(target_os = "macos") {
        return "unsupported";
    }
    match sysinfo::System::os_version().as_deref().and_then(parse_os_version) {
        Some(v) if macos_supports_system_audio(v) => "available",
        Some(_) => "unsupported",
        None => "unknown",
    }
}

/// Map `AVAuthorizationStatus` to the contract's strings. "Restricted"
/// (parental controls, MDM) is a denial the user cannot lift themselves; for
/// the recorder's purposes it is the same thing.
pub fn microphone_status_from_raw(raw: Option<isize>) -> &'static str {
    match raw {
        Some(0) => "undetermined",
        Some(1) | Some(2) => "denied",
        Some(3) => "granted",
        _ => "unknown",
    }
}

/// `"granted" | "denied" | "undetermined" | "unknown"`. Never prompts.
pub fn microphone_status() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        microphone_status_from_raw(macos::microphone_authorization())
    }
    #[cfg(not(target_os = "macos"))]
    {
        microphone_status_from_raw(None)
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    use objc2_foundation::NSString;

    // `AVCaptureDevice` lives in AVFoundation proper, which nothing else in
    // the app links (objc2-avf-audio links only the AVFAudio subframework).
    // Without this the class lookup below would return `None`.
    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {}

    /// `+[AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]`.
    /// A status query only: it never shows the permission prompt.
    pub fn microphone_authorization() -> Option<isize> {
        let class = AnyClass::get(c"AVCaptureDevice")?;
        // AVMediaTypeAudio is the constant string @"soun".
        let media_type = NSString::from_str("soun");
        // SAFETY: the selector exists on AVCaptureDevice since macOS 10.14,
        // takes one NSString and returns AVAuthorizationStatus (NSInteger).
        let status: isize =
            unsafe { msg_send![class, authorizationStatusForMediaType: &*media_type] };
        Some(status)
    }
}

/// Bytes available to the user on the volume holding `path` (or its nearest
/// existing ancestor). `None` when it cannot be read.
pub fn free_bytes(path: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let mut probe = path;
        while !probe.exists() {
            probe = probe.parent()?;
        }
        let c_path = std::ffi::CString::new(probe.as_os_str().as_bytes()).ok()?;
        // SAFETY: `c_path` is a valid NUL-terminated string and `stat` is a
        // properly sized, zero-initialised out-parameter.
        let stat = unsafe {
            let mut stat: libc::statvfs = std::mem::zeroed();
            if libc::statvfs(c_path.as_ptr(), &mut stat) != 0 {
                return None;
            }
            stat
        };
        Some((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_versions_parse_and_gate_system_audio_at_14_2() {
        assert_eq!(parse_os_version("14.2.1"), Some((14, 2)));
        assert_eq!(parse_os_version("15.0"), Some((15, 0)));
        assert_eq!(parse_os_version("14"), Some((14, 0)));
        assert_eq!(parse_os_version(" 26.1 "), Some((26, 1)));
        assert_eq!(parse_os_version(""), None);
        assert_eq!(parse_os_version("Sonoma"), None);
        assert_eq!(parse_os_version("14.x"), None);

        assert!(!macos_supports_system_audio((13, 6)));
        assert!(!macos_supports_system_audio((14, 1)));
        assert!(macos_supports_system_audio((14, 2)));
        assert!(macos_supports_system_audio((14, 10)));
        assert!(macos_supports_system_audio((15, 0)));
        assert!(macos_supports_system_audio((26, 0)));
    }

    #[test]
    fn microphone_status_maps_every_authorization_value() {
        assert_eq!(microphone_status_from_raw(Some(0)), "undetermined");
        assert_eq!(microphone_status_from_raw(Some(1)), "denied");
        assert_eq!(microphone_status_from_raw(Some(2)), "denied");
        assert_eq!(microphone_status_from_raw(Some(3)), "granted");
        assert_eq!(microphone_status_from_raw(Some(9)), "unknown");
        assert_eq!(microphone_status_from_raw(None), "unknown");
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn off_macos_nothing_is_claimed() {
        assert_eq!(system_audio_status(), "unsupported");
        assert_eq!(microphone_status(), "unknown");
    }

    #[cfg(unix)]
    #[test]
    fn free_bytes_reads_the_volume_of_a_path_that_does_not_exist_yet() {
        let tmp = std::env::temp_dir();
        let existing = free_bytes(&tmp).expect("statvfs on the temp dir");
        assert!(existing > 0);
        // The staging folder may not exist before the first recording.
        let missing = tmp.join("notesage-not-created-yet").join("recordings-staging");
        assert!(free_bytes(&missing).is_some());
    }
}
