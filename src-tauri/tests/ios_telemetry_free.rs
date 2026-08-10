//! Verifies that the iOS build target's Cargo dependency graph never links the
//! Sentry (crash reporting) or Aptabase (usage analytics) telemetry crates.
//!
//! This is the property the App Store privacy label ("Data Not Collected")
//! relies on for the mobile app (issue #587, `docs/features/mobile.md`).
//! `tauri-plugin-aptabase` is already correctly gated off for iOS in
//! `Cargo.toml` (its `sys.rs` doesn't even compile there); `sentry` and
//! `tauri-plugin-sentry` were NOT — they were plain, target-unscoped
//! `[dependencies]`, so every iOS build linked the crash-reporting SDK
//! regardless of whether a DSN was ever configured.
//!
//! `cargo tree --target <triple> -i <pkg>` resolves the dependency graph for
//! that target without compiling or linking anything, so this runs on any
//! host (no Xcode / iOS SDK required) and answers the real question: is this
//! crate reachable from a `notesage` build for that target at all.

use std::process::Command;

/// Runs `cargo tree --target aarch64-apple-ios -i <pkg>` from the crate root
/// and returns stdout. An empty (whitespace-only) result means `pkg` is
/// unreachable from the iOS dependency graph — `cargo tree -i` prints
/// "nothing to print" as a warning on stderr and leaves stdout empty in that
/// case.
fn ios_dependents_of(pkg: &str) -> String {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let output = Command::new("cargo")
        .args(["tree", "--target", "aarch64-apple-ios", "-i", pkg])
        .current_dir(manifest_dir)
        .output()
        .expect("failed to run `cargo tree` — is cargo on PATH?");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

#[test]
fn sentry_crate_is_unreachable_from_the_ios_target() {
    let dependents = ios_dependents_of("sentry");
    assert!(
        dependents.trim().is_empty(),
        "`sentry` is reachable from the iOS Cargo dependency graph — this \
         links crash-reporting telemetry into the iOS binary and would \
         invalidate the \"Data Not Collected\" App Store privacy label. \
         Gate the `sentry` dependency behind \
         `[target.'cfg(not(target_os = \"ios\"))'.dependencies]` in \
         Cargo.toml. `cargo tree -i sentry --target aarch64-apple-ios` output:\n{dependents}"
    );
}

#[test]
fn tauri_plugin_sentry_is_unreachable_from_the_ios_target() {
    let dependents = ios_dependents_of("tauri-plugin-sentry");
    assert!(
        dependents.trim().is_empty(),
        "`tauri-plugin-sentry` is reachable from the iOS Cargo dependency \
         graph. Gate it behind \
         `[target.'cfg(not(target_os = \"ios\"))'.dependencies]` alongside \
         `sentry`. `cargo tree -i tauri-plugin-sentry --target aarch64-apple-ios` output:\n{dependents}"
    );
}

#[test]
fn tauri_plugin_aptabase_is_unreachable_from_the_ios_target() {
    // Regression lock for the gating that already exists — Cargo.toml
    // already scopes this one correctly (`tauri-plugin-aptabase` doesn't
    // even compile for iOS). This test is expected to already be green; it
    // guards the property alongside the two Sentry tests above so all three
    // telemetry crates are covered by one file per the issue's Red tests.
    let dependents = ios_dependents_of("tauri-plugin-aptabase");
    assert!(
        dependents.trim().is_empty(),
        "`tauri-plugin-aptabase` is reachable from the iOS Cargo dependency \
         graph. `cargo tree -i tauri-plugin-aptabase --target aarch64-apple-ios` output:\n{dependents}"
    );
}
