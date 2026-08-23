//! The capture pipeline contract.
//!
//! Adding a share source touches more than a note builder. A capture has to
//! survive a chain, and every link is in a different language:
//!
//!   builder (Rust) → FFI (C ABI) → ShareViewController (Swift) → saved file
//!     → sweep finds its images → inliner rewrites them
//!     → `article_lead_image` locates one → gallery card shows it
//!
//! Unit tests cover the builders. Nothing covered the chain — so on
//! 2026-08-23 it broke in the two ways this file now makes impossible.
//!
//! **What happened.** X capture shipped in v0.52.0 and TestFlight build 11.
//! `build_x_note`, `x_syndication_url` and `XPost` were written and unit-tested
//! — and never exported over the FFI, so nothing in the app could call them.
//! X articles still saved, because generic readability extraction happens to
//! work on X's server-rendered status pages. What was lost was the metadata
//! path: title, author, and the COVER IMAGE. With no image in the document
//! there was nothing to inline, so `article_lead_image` found nothing and the
//! gallery fell back to a thumbnail of the rendered text. The feature looked
//! present and was structurally absent, and every test passed throughout.
//!
//! Two contracts follow, and they catch different halves:
//!
//!   1. REACHABILITY — a builder that no FFI export can reach is dead code
//!      wearing a test suite. This is the one that would have caught X.
//!   2. DISCOVERABILITY — a format carrying an image must carry it in a form
//!      the sweep can inline and the thumbnail can find. Producing an image
//!      the gallery cannot see is the same defect one stage later.
//!
//! Adding a source means adding a row. Forgetting one fails the build with the
//! stage that broke, rather than shipping a feature that quietly does nothing.

use std::fs;
use std::path::PathBuf;

fn crate_src(file: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src").join(file);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

// ---------------------------------------------------------------------------
// 1. Reachability
// ---------------------------------------------------------------------------

/// Every `pub fn build_*` note builder, and the FFI export that reaches it.
///
/// `None` means deliberately unexported, and the reason has to be written down
/// — an empty justification is how X got here.
const BUILDER_REACHABILITY: &[(&str, Option<&str>, &str)] = &[
    (
        "build_capture_note",
        Some("notesage_capture_contents"),
        "the plain link note",
    ),
    (
        "build_video_note",
        Some("notesage_capture_video_contents"),
        "oEmbed video metadata capture",
    ),
    (
        "build_article_note",
        Some("notesage_capture_article_contents"),
        "extracted article, markdown format",
    ),
    (
        "build_article_html_document",
        Some("notesage_capture_article_html_contents"),
        "extracted article, HTML format",
    ),
    (
        // NOT waived. This is the live defect, recorded rather than hidden:
        // the builder exists, is unit-tested, and no FFI export reaches it, so
        // X posts never take the X-aware path. Wiring it is tracked work; the
        // row stays failing-shaped so that landing the wiring is what removes
        // the exception, not editing this comment.
        "build_x_note",
        None,
        "UNWIRED (2026-08-23): X post capture has no FFI export — see the module docs",
    ),
];

#[test]
fn every_note_builder_is_reachable_or_documented() {
    let lib = crate_src("lib.rs");
    let ffi = crate_src("ffi.rs");

    let mut missing_rows = Vec::new();
    for line in lib.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("pub fn build_") {
            let name = format!("build_{}", rest.split(['(', '<', ' ']).next().unwrap_or(""));
            if !BUILDER_REACHABILITY.iter().any(|(b, _, _)| *b == name) {
                missing_rows.push(name);
            }
        }
    }
    assert!(
        missing_rows.is_empty(),
        "New note builder(s) with no entry in BUILDER_REACHABILITY: {missing_rows:?}.\n\
         Add a row naming the FFI export that reaches it — or `None` with a reason.\n\
         A builder nothing can call is dead code with a passing test suite; that is\n\
         exactly how X capture shipped twice while doing nothing."
    );

    for (builder, export, why) in BUILDER_REACHABILITY {
        match export {
            Some(sym) => assert!(
                ffi.contains(sym),
                "`{builder}` ({why}) claims FFI export `{sym}`, which is absent from ffi.rs.\n\
                 Either the export was renamed or removed — in both cases the builder is\n\
                 now unreachable from the app."
            ),
            None => assert!(
                !why.trim().is_empty(),
                "`{builder}` is unexported with no reason given. Say why, or wire it."
            ),
        }
    }
}

#[test]
fn the_unwired_x_path_is_still_unwired() {
    // A canary, not an endorsement. It documents the current broken state so
    // that WIRING X — the actual fix — trips this test and forces the
    // reachability row above to be corrected at the same time. Without it the
    // `None` row would quietly stay `None` forever.
    let ffi = crate_src("ffi.rs");
    let wired = ffi.contains("build_x_note") || ffi.contains("x_syndication");
    assert!(
        !wired,
        "X capture now appears wired into ffi.rs. Good — update BUILDER_REACHABILITY\n\
         to name the export, and delete this canary."
    );
}

// ---------------------------------------------------------------------------
// 2. Discoverability
// ---------------------------------------------------------------------------

const IMAGE_URL: &str = "https://cdn.example/cover.jpg";
const DATA_URI: &str = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const NOW: &str = "2026-08-23T10:00:00Z";

fn input(url: &str) -> notesage_capture::CaptureInput {
    notesage_capture::CaptureInput {
        url: url.to_string(),
        title: Some("A Title".to_string()),
        ..Default::default()
    }
}

/// A capture that carries an image must carry it somewhere the gallery can
/// reach: the URL has to be findable, rewritable, and the result locatable by
/// `article_lead_image`. A format failing any step shows a thumbnail of text.
#[test]
fn markdown_capture_image_survives_to_the_thumbnail() {
    let meta = notesage_capture::VideoMeta {
        title: Some("A Title".into()),
        thumbnail_url: Some(IMAGE_URL.into()),
        ..Default::default()
    };
    let note = notesage_capture::build_video_note(&input("https://youtu.be/abc"), &meta, NOW);

    let urls = notesage_capture::markdown_image_urls(&note.contents);
    assert!(
        urls.iter().any(|u| u == IMAGE_URL),
        "the sweep cannot find this capture's image, so it will never be inlined.\n\
         found: {urls:?}"
    );

    let inlined = notesage_capture::inline_markdown_images(
        &note.contents,
        &[(IMAGE_URL.to_string(), DATA_URI.to_string())],
    );
    assert!(
        notesage_capture::article_lead_image(&inlined).is_some(),
        "image inlined but `article_lead_image` cannot locate it — the gallery card\n\
         falls back to a thumbnail of the rendered text.\n\n{inlined}"
    );
}

#[test]
fn html_capture_image_survives_to_the_thumbnail() {
    let html = format!(r#"<article><p>Words.</p><img src="{IMAGE_URL}"></article>"#);

    let urls = notesage_capture::article_image_urls(&html);
    assert!(urls.iter().any(|u| u == IMAGE_URL), "sweep cannot find it: {urls:?}");

    let inlined = notesage_capture::inline_article_images(
        &html,
        &[(IMAGE_URL.to_string(), DATA_URI.to_string())],
    );
    assert!(
        notesage_capture::article_lead_image(&inlined).is_some(),
        "HTML capture's image is not thumbnail-discoverable:\n{inlined}"
    );
}

#[test]
fn a_capture_with_no_image_is_allowed_to_have_no_thumbnail() {
    // The contract is "an image that exists must survive", not "every note has
    // an image". A link note legitimately has none, and must not be forced to
    // invent one.
    let note = notesage_capture::build_capture_note(&input("https://example.com/x"), NOW);
    assert!(notesage_capture::markdown_image_urls(&note.contents).is_empty());
    assert!(notesage_capture::article_lead_image(&note.contents).is_none());
}
