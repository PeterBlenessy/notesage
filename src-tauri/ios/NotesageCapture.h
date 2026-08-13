//
//  NotesageCapture.h
//  Bridging header for the `notesage-capture` Rust static library.
//
//  Add this file to the Share Extension target's "Objective-C Bridging Header"
//  build setting, and link `libnotesage_capture.a` (built from
//  `src-tauri/crates/notesage-capture`) into the same target. See
//  `src-tauri/ios/README.md` for the build step.
//
//  Why the extension calls Rust at all: the capture-note format — filename
//  slug, `type: capture` frontmatter, body layout — is shared with what the
//  desktop workflows expect. Reimplementing it in Swift means two
//  implementations that drift silently, and only one of them has tests. The
//  extension owns the write (it holds the security-scoped bookmark); Rust owns
//  the format.
//
//  Memory contract: both builders return a heap-allocated, NUL-terminated
//  UTF-8 string that the caller MUST release with
//  notesage_capture_string_free(). They return NULL only if the Rust side
//  panicked — treat that as "could not build the note", not as a crash.
//
//  All `const char *` parameters are NUL-terminated UTF-8; NULL means "absent"
//  for the optional ones. `tags` is a comma-separated list; NULL or empty
//  yields the default `inbox` tag.
//

#ifndef NOTESAGE_CAPTURE_H
#define NOTESAGE_CAPTURE_H

#ifdef __cplusplus
extern "C" {
#endif

/// Relative path for the note, e.g. `Inbox/2026-08-02-101400-a-title.md`.
/// Caller frees with notesage_capture_string_free().
char *notesage_capture_rel_path(const char *url,
                                const char *title,
                                const char *selection_text,
                                const char *tags);

/// Full file contents (frontmatter + body).
/// Caller frees with notesage_capture_string_free().
char *notesage_capture_contents(const char *url,
                                const char *title,
                                const char *selection_text,
                                const char *tags);

/// Release a string returned above. Passing NULL is a no-op.
/// Article capture note contents from fetched page HTML (rich web capture).
/// A detected video page (poster image with a play-button overlay, no real
/// player once scripts are stripped) becomes a link-style note instead of
/// embedding the poster as ordinary content. NULL when the page is neither
/// a video page nor yields a genuine article — fall back to the link note.
/// Caller frees with notesage_capture_string_free().
char *notesage_capture_article_contents(const char *url,
                                        const char *title,
                                        const char *selection_text,
                                        const char *tags,
                                        const char *html);

/// Link-style HTML document for the Page (HTML) capture format, when `url`/
/// `html` is a detected video page. NULL when it is not a detected video
/// page — the caller keeps writing the raw fetched HTML unchanged. Caller
/// frees with notesage_capture_string_free().
char *notesage_capture_video_html(const char *url,
                                  const char *title,
                                  const char *html);

void notesage_capture_string_free(char *ptr);

#ifdef __cplusplus
}
#endif

#endif /* NOTESAGE_CAPTURE_H */
