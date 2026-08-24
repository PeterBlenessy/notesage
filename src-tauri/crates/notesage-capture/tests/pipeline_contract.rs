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
        "build_x_note",
        Some("notesage_capture_x_contents"),
        "X post metadata note — the fallback when there is no article to extract",
    ),
    (
        "build_x_article_note",
        Some("notesage_capture_x_contents"),
        "X article, markdown format: extraction enriched with syndication metadata",
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

// The `the_unwired_x_path_is_still_unwired` canary lived here until
// 2026-08-24. It tripped when X was wired, which is what it was for, and the
// BUILDER_REACHABILITY rows above now name the real export. Nothing replaces
// it — a canary for a fixed defect is noise.
//
// What DOES replace it is the Swift check below, because the X incident
// exposed that "reachable from ffi.rs" was only half the chain.

/// Read a Share Extension source. These live outside the crate, which is the
/// point: the chain the module note draws crosses that boundary, and a
/// contract that stops at the crate edge stops one link short of where X
/// actually broke.
fn ios_src(file: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../ios")
        .join(file);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

/// Does `haystack` name `symbol` as a whole word?
///
/// Needed because Swift reaches these exports two ways and both are correct:
/// called directly (`notesage_capture_x_metadata_url(u)`) or passed as a
/// function value (`callCapture(notesage_capture_rel_path, …)`). Requiring a
/// following `(` would reject the second — a legitimate pattern used four
/// times in LibraryCapture.swift.
fn mentions(haystack: &str, symbol: &str) -> bool {
    let ident = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut from = 0usize;
    while let Some(rel) = haystack[from..].find(symbol) {
        let start = from + rel;
        let end = start + symbol.len();
        let before_ok = haystack[..start].chars().next_back().map_or(true, |c| !ident(c));
        let after_ok = haystack[end..].chars().next().map_or(true, |c| !ident(c));
        if before_ok && after_ok {
            return true;
        }
        from = end;
    }
    false
}

/// Every FFI export, and the Swift that calls it.
///
/// An export nothing calls is the same defect as a builder nothing exports —
/// one stage further down. X had a working builder and would, with only the
/// first contract, have been declared fixed by adding an export that Swift
/// never invoked.
///
/// Deliberately a text scan rather than a build: the Share Extension only
/// compiles on a Mac with an iOS toolchain, and a contract that cannot run in
/// CI is a contract that runs never.
const EXPORT_CALL_SITES: &[(&str, &str)] = &[
    ("notesage_capture_contents", "LibraryCapture.swift"),
    ("notesage_capture_rel_path", "LibraryCapture.swift"),
    ("notesage_capture_rel_path_from_html", "LibraryCapture.swift"),
    ("notesage_capture_oembed_url", "LibraryCapture.swift"),
    ("notesage_capture_video_rel_path", "LibraryCapture.swift"),
    ("notesage_capture_video_contents", "LibraryCapture.swift"),
    ("notesage_capture_article_contents", "LibraryCapture.swift"),
    ("notesage_capture_article_html_contents", "LibraryCapture.swift"),
    ("notesage_capture_x_metadata_url", "LibraryCapture.swift"),
    ("notesage_capture_x_rel_path", "LibraryCapture.swift"),
    ("notesage_capture_x_contents", "LibraryCapture.swift"),
    ("notesage_capture_x_html_contents", "LibraryCapture.swift"),
    ("notesage_capture_string_free", "LibraryCapture.swift"),
];

#[test]
fn every_ffi_export_is_called_from_swift_and_declared_in_the_header() {
    let ffi = crate_src("ffi.rs");
    let header = ios_src("NotesageCapture.h");

    // Collect the real export list from the source rather than trusting the
    // table — a NEW export with no row is exactly the gap being closed.
    let mut exports: Vec<String> = Vec::new();
    for line in ffi.lines() {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix("pub unsafe extern \"C\" fn ") {
            exports.push(rest.split('(').next().unwrap_or("").trim().to_string());
        }
    }
    assert!(!exports.is_empty(), "no FFI exports found — did the signature style change?");

    for export in &exports {
        let Some((_, file)) = EXPORT_CALL_SITES.iter().find(|(e, _)| e == export) else {
            panic!(
                "FFI export `{export}` has no entry in EXPORT_CALL_SITES.\n\
                 Name the Swift file that calls it. An export nothing calls is the\n\
                 same dead code as an unexported builder, one stage later — and that\n\
                 is precisely how X capture looked present while doing nothing."
            );
        };

        // A bare `contains` is not enough: every one of these names is a
        // PREFIX of another. `notesage_capture_rel_path` is a prefix of
        // `notesage_capture_rel_path_from_html`, so a substring check would
        // report the first as present on the strength of the second — passing
        // for entirely the wrong reason, which is the failure mode this whole
        // file exists to prevent. Match on a word boundary instead.
        assert!(
            mentions(&header, export),
            "`{export}` is not declared in NotesageCapture.h, so Swift cannot see it.\n\
             The bridging header is the only thing that makes an export callable."
        );

        let swift = ios_src(file);
        assert!(
            mentions(&swift, export),
            "`{export}` is declared and exported but never called from {file}.\n\
             Wire it, or delete it — a reachable-but-uncalled export passes every\n\
             other test in this file while shipping nothing."
        );
    }
}

#[test]
fn the_share_controller_routes_x_urls_through_the_x_writer() {
    // The final link: `LibraryCapture` can expose a perfect X writer and
    // `ShareViewController` can still send every X share down the generic
    // article path. That is a one-line omission with no other symptom than
    // the bug we started from.
    let controller = ios_src("ShareViewController.swift");
    assert!(
        controller.contains("xMetadataEndpoint"),
        "ShareViewController never asks whether a URL is an X status, so the X\n\
         path cannot be taken no matter what the crate exports."
    );
    assert!(
        controller.contains("writeXCapture"),
        "ShareViewController never calls writeXCapture — X shares still take the\n\
         generic article path, which is the defect this whole file exists for."
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
fn an_x_captures_cover_survives_to_the_thumbnail() {
    // The exact chain that failed. An X Article's cover is rendered by the
    // client, so extraction never sees it — the note came out imageless and
    // the gallery showed a thumbnail of the article's own text.
    //
    // Runs the whole way: enrich → note → sweep finds the URL → inline →
    // `article_lead_image` locates it. Each step is a place it broke before.
    let post = notesage_capture::XPost {
        article_title: Some("The real subject".into()),
        cover_image_url: Some(IMAGE_URL.into()),
        author_handle: Some("rvaniaaaa".into()),
        ..Default::default()
    };
    let mut article = notesage_capture::Article {
        title: Some("Rania (@rvaniaaaa) on X".into()),
        markdown: "The extracted body of the piece.".into(),
        html: "<p>The extracted body of the piece.</p>".into(),
    };
    notesage_capture::enrich_x_article(&mut article, &post);

    let note = notesage_capture::build_x_article_note(
        &input("https://x.com/rvaniaaaa/status/1"),
        &article,
        &post,
        NOW,
    );

    let urls = notesage_capture::markdown_image_urls(&note.contents);
    assert!(
        urls.iter().any(|u| u == IMAGE_URL),
        "the sweep cannot find the X cover, so it will never be inlined: {urls:?}"
    );

    let inlined = notesage_capture::inline_markdown_images(
        &note.contents,
        &[(IMAGE_URL.to_string(), DATA_URI.to_string())],
    );
    assert!(
        notesage_capture::article_lead_image(&inlined).is_some(),
        "X cover inlined but not thumbnail-discoverable — back to a picture of\n\
         the text, which is the whole reported defect.\n\n{inlined}"
    );
}

#[test]
fn an_x_url_is_not_treated_as_a_video_page() {
    // Load-bearing, and easy to break without noticing. The share sheet hides
    // BOTH article formats for any URL with an oEmbed endpoint (a video page
    // has no article to extract). Adding x.com to `oembed_url` — plausible,
    // since X hosts video — would leave X shares offering only Video and Link,
    // and every path built here would become unreachable. Silently: the picker
    // would still work, captures would still save, and the enrichment would
    // simply never run again.
    for url in [
        "https://x.com/rvaniaaaa/status/1234567890",
        "https://twitter.com/jack/status/20",
    ] {
        assert!(
            notesage_capture::oembed_url(url).is_none(),
            "{url} now has an oEmbed endpoint, so the share sheet will offer only\n\
             Video + Link for it and the X article path can never run.\n\
             If X really needs a video format, it must not displace the article\n\
             formats for status URLs."
        );
        assert!(
            notesage_capture::x_syndication_url(url).is_some(),
            "{url} is no longer recognised as an X status — the enrichment path\n\
             is unreachable for it."
        );
    }
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
