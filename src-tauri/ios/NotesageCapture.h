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

/// The document behind an Office web-viewer URL (#868), or NULL. Free with
/// notesage_capture_string_free.
char *notesage_capture_viewer_document_url(const char *url);

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

/// A saved LINK WITH ITS PREVIEW (#839): title, description and lead image
/// from the page's own og: tags, for a page that yields no article. The rung
/// between the article capture above and the bare link note. NULL only when
/// the page declares no title at all.
/// Caller frees with notesage_capture_string_free().
char *notesage_capture_card_html_contents(const char *url, const char *html);

/// The embed-data endpoint for an X status URL, or NULL when the URL is not
/// one. Fetch it and pass the JSON to the three X builders below.
///
/// That JSON is METADATA, not the capture: it carries the post's real title,
/// author and cover image, but only a ~200-character teaser of an Article's
/// text. The body still comes from extracting the page. Every builder below
/// works with a NULL json — the endpoint is undocumented and may stop
/// answering, and a share must not fail when it does.
/// Caller frees with notesage_capture_string_free().
char *notesage_capture_x_metadata_url(const char *url);

/// Relative path for an X capture, named from the post's real title instead of
/// the page chrome (`<name> (@<handle>) on X`). Caller frees.
char *notesage_capture_x_rel_path(const char *url,
                                  const char *title,
                                  const char *x_json);

/// Contents of an X capture note (markdown): the extracted article enriched
/// with the real title, the cover image as its lead, and author/handle/date.
/// Falls back to a metadata-only note when there is no article to extract, so
/// this returns NULL only on panic. Caller frees.
char *notesage_capture_x_contents(const char *url,
                                  const char *title,
                                  const char *selection_text,
                                  const char *tags,
                                  const char *html,
                                  const char *x_json);

/// Contents of an X capture as a self-contained HTML document, same
/// enrichment. NULL when extraction declines — the caller falls back to the
/// markdown note, which still carries the metadata. Caller frees.
char *notesage_capture_x_html_contents(const char *url,
                                       const char *title,
                                       const char *html,
                                       const char *x_json);

/// 1 when the syndication payload is a long-form X Article, 0 otherwise
/// (including absent or unparseable JSON). Lets the caller decide whether a
/// render pass is worth its latency: a plain post has no article to find.
/// Returns a value, not a string — nothing to free.
unsigned char notesage_capture_x_is_article(const char *x_json);

/// Extension ("pdf", "epub", "pptx", "jpg", "mp4", "mp3", …) for a
/// `Content-Type` that serves a storable document, or NULL when the response is
/// a page to extract.
///
/// A URL does not always lead to an article. A link to a PDF used to take the
/// article path, fail the `text/html` check, and fall through to a link note —
/// a `.md` file holding only the URL, after the sheet had promised otherwise.
char *notesage_capture_linked_document_extension(const char *content_type);

/// Filename a server suggested via `Content-Disposition`, basename only, or
/// NULL. The URL's last segment is often an opaque id while the header carries
/// the real title. A server-supplied path is never honoured.
char *notesage_capture_disposition_filename(const char *header);

void notesage_capture_string_free(char *ptr);

#ifdef __cplusplus
}
#endif

#endif /* NOTESAGE_CAPTURE_H */
