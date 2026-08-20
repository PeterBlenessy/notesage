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

/// The provider's official oEmbed endpoint for a video URL, or NULL when the
/// URL is not a recognised video page. Fetch it and pass the JSON to the two
/// video builders below. Caller frees with notesage_capture_string_free().
char *notesage_capture_oembed_url(const char *url);

/// Relative path for a video capture note (named from the provider's title
/// when the sharer gave us none). Caller frees.
char *notesage_capture_video_rel_path(const char *url,
                                      const char *title,
                                      const char *oembed_json);

/// Contents of a video capture note: a labelled source link, the author, and
/// the provider's clean poster as a plain image. Caller frees.
char *notesage_capture_video_contents(const char *url,
                                      const char *title,
                                      const char *selection_text,
                                      const char *tags,
                                      const char *oembed_json);

/// Relative path for the note, using the fetched page's own metadata
/// (og:title / twitter:title / <title>) when the sharer's title is missing or
/// is merely the URL again — which is what YouTube and friends hand over.
/// Caller frees with notesage_capture_string_free().
char *notesage_capture_rel_path_from_html(const char *url,
                                          const char *title,
                                          const char *html);

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
/// NULL when the page yields no genuine article — fall back to the link
/// note. Caller frees with notesage_capture_string_free().
char *notesage_capture_article_contents(const char *url,
                                        const char *title,
                                        const char *selection_text,
                                        const char *tags,
                                        const char *html);

/// Article-ONLY HTML capture note contents (#612): the same readable
/// extraction as above, rendered into a self-contained styled document
/// instead of markdown. NULL when the page yields no genuine article.
/// Caller frees with notesage_capture_string_free().
char *notesage_capture_article_html_contents(const char *url,
                                             const char *title,
                                             const char *selection_text,
                                             const char *tags,
                                             const char *html);

void notesage_capture_string_free(char *ptr);

#ifdef __cplusplus
}
#endif

#endif /* NOTESAGE_CAPTURE_H */
