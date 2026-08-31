//! C ABI over [`build_capture_note`], for the iOS Share Extension.
//!
//! The extension runs in its own process with a hard memory budget and no
//! access to the app's Tauri runtime, so it links this crate as a static
//! library and calls these two functions. That is what keeps the capture-note
//! format in exactly one place: Swift decides *where* to write (only it holds
//! the security-scoped bookmark) and this decides *what* to write.
//!
//! Contract, deliberately minimal:
//!
//! - Every `*const c_char` in is a NUL-terminated UTF-8 string. `NULL` means
//!   "absent" for the optional arguments.
//! - Both functions return a heap-allocated NUL-terminated string that the
//!   caller **must** hand back to [`notesage_capture_string_free`]. Returning
//!   owned strings (rather than writing into a caller buffer) avoids a
//!   two-call length dance for what is always a small note.
//! - Invalid UTF-8 in an argument is treated as absent rather than aborting:
//!   a share sheet handing over a mangled title should still capture the link.
//! - Never panics across the boundary — an unwind through the C ABI is
//!   undefined behaviour, so the whole body is wrapped in `catch_unwind` and a
//!   panic surfaces as a NULL return the caller can handle.

use std::ffi::{c_char, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};

use crate::{
    build_article_html_document, build_article_note, build_capture_note,
    build_card_html_document, build_video_note, extract_page_card,
    build_x_article_note, build_x_note, enrich_x_article, extract_article, extract_meta_title,
    filename_from_content_disposition, is_x_chrome_title, linked_document_for_content_type,
    meaningful_title, oembed_url, parse_oembed, parse_x_post, timestamps,
    x_syndication_url, Article, CaptureInput, XPost,
};

/// Borrow a C string as `Option<String>`; `NULL` or invalid UTF-8 → `None`.
unsafe fn opt_str(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    CStr::from_ptr(ptr).to_str().ok().map(str::to_owned)
}

fn into_c_string(value: String) -> *mut c_char {
    // A NUL inside the note would truncate it silently on the Swift side;
    // there is no legitimate NUL in markdown, so strip rather than fail.
    let cleaned: String = value.chars().filter(|c| *c != '\0').collect();
    match CString::new(cleaned) {
        Ok(s) => s.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Build the capture note's **relative path** (e.g. `Inbox/2026-08-02-101400-x-com.md`).
///
/// `tags` is a comma-separated list; empty or `NULL` yields the default `inbox` tag.
/// Returns NULL on panic. Free with [`notesage_capture_string_free`].
///
/// # Safety
/// All pointers must be NUL-terminated C strings or NULL, valid for the call.
#[no_mangle]
pub unsafe extern "C" fn notesage_capture_rel_path(
    url: *const c_char,
    title: *const c_char,
    selection_text: *const c_char,
    tags: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let input = input_from(url, title, selection_text, tags);
        let (now, _stamp) = timestamps();
        into_c_string(build_capture_note(&input, &now).rel_path)
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Build the capture note's **file contents** (frontmatter + body).
///
/// Returns NULL on panic. Free with [`notesage_capture_string_free`].
///
/// # Safety
/// All pointers must be NUL-terminated C strings or NULL, valid for the call.
#[no_mangle]
pub unsafe extern "C" fn notesage_capture_contents(
    url: *const c_char,
    title: *const c_char,
    selection_text: *const c_char,
    tags: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let input = input_from(url, title, selection_text, tags);
        let (now, _stamp) = timestamps();
        into_c_string(build_capture_note(&input, &now).contents)
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Build the capture **rel path** using the page's own metadata as the title
/// fallback. Same as `notesage_capture_rel_path`, but for callers that have
/// already fetched the HTML (the "Page (HTML)" format) — several share sheets
/// hand over the URL as the title, and without the page's `og:title` the file
/// ends up named after a mangled URL.
///
/// # Safety
/// All arguments must be NUL-terminated C strings or NULL. The returned
/// pointer is owned by the caller and must be freed with
/// `notesage_capture_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn notesage_capture_rel_path_from_html(
    url: *const c_char,
    title: *const c_char,
    html: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let mut input = input_from(url, title, std::ptr::null(), std::ptr::null());
        if meaningful_title(input.title.as_deref()).is_none() {
            input.title = opt_str(html).and_then(|h| extract_meta_title(&h));
        }
        let (now, _stamp) = timestamps();
        into_c_string(build_capture_note(&input, &now).rel_path)
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// The provider's official oEmbed endpoint for a video URL, or NULL when the
/// URL is not a video page we recognise. The caller fetches it and hands the
/// JSON back to the two builders below.
///
/// # Safety
/// `url` must be a NUL-terminated C string or NULL. The returned pointer is
/// owned by the caller and must be freed with `notesage_capture_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn notesage_capture_oembed_url(url: *const c_char) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| match opt_str(url).and_then(|u| oembed_url(&u)) {
        Some(endpoint) => into_c_string(endpoint),
        None => std::ptr::null_mut(),
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Rel path for a video capture note, named from the provider's title when
/// the sharer gave us nothing better.
///
/// # Safety
/// All arguments must be NUL-terminated C strings or NULL. The returned
/// pointer is owned by the caller and must be freed with
/// `notesage_capture_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn notesage_capture_video_rel_path(
    url: *const c_char,
    title: *const c_char,
    oembed_json: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let input = input_from(url, title, std::ptr::null(), std::ptr::null());
        let meta = opt_str(oembed_json).map(|j| parse_oembed(&j)).unwrap_or_default();
        let (now, _stamp) = timestamps();
        into_c_string(build_video_note(&input, &meta, &now).rel_path)
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Contents of a video capture note: a labelled link to the source, the
/// author, and the provider's clean poster frame as a plain image.
///
/// # Safety
/// All arguments must be NUL-terminated C strings or NULL. The returned
/// pointer is owned by the caller and must be freed with
/// `notesage_capture_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn notesage_capture_video_contents(
    url: *const c_char,
    title: *const c_char,
    selection_text: *const c_char,
    tags: *const c_char,
    oembed_json: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let input = input_from(url, title, selection_text, tags);
        let meta = opt_str(oembed_json).map(|j| parse_oembed(&j)).unwrap_or_default();
        let (now, _stamp) = timestamps();
        into_c_string(build_video_note(&input, &meta, &now).contents)
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Build an ARTICLE capture note's **file contents** from fetched page HTML
/// (rich web capture, #584): readable extraction + HTML→Markdown + the v2
/// note format (`capture_format: markdown`).
///
/// Returns NULL when the page does not yield a genuine article (nav-heavy
/// page, near-empty body, non-HTML) — the caller falls back to the link-only
/// note — or on panic. Free with [`notesage_capture_string_free`].
///
/// # Safety
/// All pointers must be NUL-terminated C strings or NULL, valid for the call.
#[no_mangle]
pub unsafe extern "C" fn notesage_capture_article_contents(
    url: *const c_char,
    title: *const c_char,
    selection_text: *const c_char,
    tags: *const c_char,
    html: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let input = input_from(url, title, selection_text, tags);
        let html = match opt_str(html) {
            Some(h) => h,
            None => return std::ptr::null_mut(),
        };
        let article = match extract_article(&html, &input.url) {
            Some(a) => a,
            None => return std::ptr::null_mut(),
        };
        let (now, _stamp) = timestamps();
        into_c_string(build_article_note(&input, &article, &now).contents)
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Build an ARTICLE-ONLY HTML capture note's **file contents** (#612): the
/// same readable extraction as [`notesage_capture_article_contents`], rendered
/// into a self-contained styled document instead of markdown.
///
/// Returns NULL when the page yields no genuine article — the caller falls
/// back, and a share never fails outright. Free with
/// [`notesage_capture_string_free`].
///
/// # Safety
/// All pointers must be NUL-terminated C strings or NULL, valid for the call.
#[no_mangle]
pub unsafe extern "C" fn notesage_capture_article_html_contents(
    url: *const c_char,
    title: *const c_char,
    selection_text: *const c_char,
    tags: *const c_char,
    html: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let input = input_from(url, title, selection_text, tags);
        let html = match opt_str(html) {
            Some(h) => h,
            None => return std::ptr::null_mut(),
        };
        let article = match extract_article(&html, &input.url) {
            Some(a) => a,
            None => return std::ptr::null_mut(),
        };
        let title = meaningful_title(input.title.as_deref()).or_else(|| article.title.clone());
        into_c_string(build_article_html_document(&article, title.as_deref(), &input.url))
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// A saved LINK WITH ITS PREVIEW, for a page that yields no article (#839).
///
/// The rung between the article capture above and the bare link note: a topic
/// hub or a gated page still declares a title, a summary and a lead image, and
/// saving a naked URL while holding all three is worse than the user can see we
/// were capable of.
///
/// Returns NULL only when the page declares no title at all — the genuine last
/// resort, which belongs to the link note. Free with
/// [`notesage_capture_string_free`].
///
/// # Safety
/// All pointers must be NUL-terminated C strings or NULL, valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn notesage_capture_card_html_contents(
    url: *const c_char,
    html: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let (url, html) = match (opt_str(url), opt_str(html)) {
            (Some(u), Some(h)) => (u, h),
            _ => return std::ptr::null_mut(),
        };
        match extract_page_card(&html, &url) {
            Some(card) => into_c_string(build_card_html_document(&card, &url)),
            None => std::ptr::null_mut(),
        }
    }))
    .unwrap_or(std::ptr::null_mut())
}

// ---------------------------------------------------------------------------
// X posts
//
// Four exports, mirroring the video trio's shape: one that names an endpoint
// for the caller to fetch, and builders that take the returned JSON.
//
// The syndication JSON is METADATA, never the capture. Read the module note
// above `x_syndication_url` in lib.rs before changing any of this: the
// endpoint carries a ~200-character teaser, and an X Article's real body comes
// from extracting the status page. Every function here degrades to the plain
// article path when `x_json` is NULL or unparseable, because that endpoint is
// undocumented and can stop answering without notice.
// ---------------------------------------------------------------------------

/// The embed-data endpoint for an X status URL, or NULL when the URL is not
/// one. The caller fetches it and hands the JSON to the builders below.
///
/// # Safety
/// `url` must be a NUL-terminated C string or NULL. The returned pointer is
/// owned by the caller and must be freed with `notesage_capture_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn notesage_capture_x_metadata_url(url: *const c_char) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(
        || match opt_str(url).and_then(|u| x_syndication_url(&u)) {
            Some(endpoint) => into_c_string(endpoint),
            None => std::ptr::null_mut(),
        },
    ))
    .unwrap_or(std::ptr::null_mut())
}

/// Rel path for an X capture, named from the post's real title rather than the
/// page chrome.
///
/// Without this every X capture is named `<display name> (@<handle>) on X`, so
/// a second article by the same author collides into `…-1.md` and neither file
/// says what it holds.
///
/// # Safety
/// All arguments must be NUL-terminated C strings or NULL. The returned
/// pointer is owned by the caller and must be freed with
/// `notesage_capture_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn notesage_capture_x_rel_path(
    url: *const c_char,
    title: *const c_char,
    x_json: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let mut input = input_from(url, title, std::ptr::null(), std::ptr::null());
        let post = x_post_from(x_json);
        if input.title.as_deref().map(is_x_chrome_title).unwrap_or(false) {
            input.title = None;
        }
        if meaningful_title(input.title.as_deref()).is_none() {
            input.title = post.article_title.clone();
        }
        let (now, _stamp) = timestamps();
        into_c_string(build_capture_note(&input, &now).rel_path)
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Contents of an X capture note (markdown): the extracted article, enriched
/// with the post's real title, its cover image as the lead, and the author /
/// handle / posted-at that only syndication knows.
///
/// Falls back to the metadata-only note when extraction declines — a post with
/// no article to extract still deserves a note. Returns NULL only on panic, so
/// unlike the plain article export this one always yields something.
///
/// # Safety
/// All pointers must be NUL-terminated C strings or NULL, valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn notesage_capture_x_contents(
    url: *const c_char,
    title: *const c_char,
    selection_text: *const c_char,
    tags: *const c_char,
    html: *const c_char,
    x_json: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let input = input_from(url, title, selection_text, tags);
        let post = x_post_from(x_json);
        let (now, _stamp) = timestamps();

        match x_article_from(html, &input.url, &post) {
            Some(article) => {
                into_c_string(build_x_article_note(&input, &article, &post, &now).contents)
            }
            // No extractable article — the metadata note is the whole point of
            // having a fallback builder.
            None => into_c_string(build_x_note(&input, &post, &now).contents),
        }
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Contents of an X capture as a self-contained HTML document, with the same
/// enrichment as the markdown path.
///
/// Returns NULL when extraction declines — an HTML document with no article in
/// it is not worth writing, and the caller falls back to the markdown note
/// (which still has the metadata) or the link note.
///
/// # Safety
/// All pointers must be NUL-terminated C strings or NULL, valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn notesage_capture_x_html_contents(
    url: *const c_char,
    title: *const c_char,
    html: *const c_char,
    x_json: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let input = input_from(url, title, std::ptr::null(), std::ptr::null());
        let post = x_post_from(x_json);
        let article = match x_article_from(html, &input.url, &post) {
            Some(a) => a,
            None => return std::ptr::null_mut(),
        };
        let title = meaningful_title(input.title.as_deref())
            .filter(|t| !is_x_chrome_title(t))
            .or_else(|| article.title.clone());
        into_c_string(build_article_html_document(&article, title.as_deref(), &input.url))
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Is this syndication payload a long-form X ARTICLE, rather than a plain post?
///
/// Returns 1 for an Article, 0 otherwise (including absent or unparseable
/// JSON). Exists because Swift needs the answer to decide whether a render
/// pass is worth up to five seconds — a plain post has no article to find, so
/// rendering one buys nothing.
///
/// The alternative was a substring check on the raw JSON in Swift, which was
/// tried and reverted: `parse_x_post` already computes this, and this crate's
/// own rule is that the crate decides. Two opinions about the same payload is
/// how the extensions drifted in the first place.
///
/// # Safety
/// `x_json` must be a NUL-terminated C string or NULL.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn notesage_capture_x_is_article(x_json: *const c_char) -> u8 {
    catch_unwind(AssertUnwindSafe(|| {
        u8::from(x_post_from(x_json).article_title.is_some())
    }))
    .unwrap_or(0)
}

/// Parse the syndication JSON, treating absent/invalid as "no metadata" rather
/// than failing the capture. The endpoint is undocumented; it WILL change.
unsafe fn x_post_from(x_json: *const c_char) -> XPost {
    opt_str(x_json).map(|j| parse_x_post(&j)).unwrap_or_default()
}

/// Extract and enrich in one step — the two always travel together, and doing
/// them separately at each call site is how one path ends up un-enriched.
unsafe fn x_article_from(html: *const c_char, url: &str, post: &XPost) -> Option<Article> {
    let html = opt_str(html)?;
    let mut article = extract_article(&html, url)?;
    enrich_x_article(&mut article, post);
    Some(article)
}

/// Free a string returned by this module. Passing NULL is a no-op.
///
/// # Safety
/// `ptr` must be a pointer previously returned by one of the functions above,
/// and must not be freed twice.
#[no_mangle]
pub unsafe extern "C" fn notesage_capture_string_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(CString::from_raw(ptr));
    }
}

unsafe fn input_from(
    url: *const c_char,
    title: *const c_char,
    selection_text: *const c_char,
    tags: *const c_char,
) -> CaptureInput {
    CaptureInput {
        url: opt_str(url).unwrap_or_default(),
        title: opt_str(title),
        selection_text: opt_str(selection_text),
        tags: opt_str(tags)
            .map(|t| {
                t.split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// Extension for a `Content-Type` that serves a storable document, or NULL when
/// the response is a page to extract.
///
/// A URL does not always lead to an article. A link to a PDF, EPUB, deck,
/// image, video or audio file used to take the article path, fail the
/// `text/html` check, and fall through to a link note — a `.md` file holding
/// only the URL, after the sheet had promised otherwise.
///
/// # Safety
/// `content_type` must be a NUL-terminated C string or NULL. The returned
/// pointer is owned by the caller and must be freed with
/// `notesage_capture_string_free`.
#[no_mangle]
pub unsafe extern "C" fn notesage_capture_linked_document_extension(
    content_type: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        match opt_str(content_type)
            .and_then(|ct| linked_document_for_content_type(&ct))
        {
            Some(doc) => into_c_string(doc.extension.to_string()),
            None => std::ptr::null_mut(),
        }
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// The filename a server suggested via `Content-Disposition`, basename only.
///
/// The URL's own last segment is often an opaque id — the reported case was
/// `kFcVnC0GHB_ZVnO5mxL0dg` — while the header carried the document's real
/// title. A server-supplied path is never honoured.
///
/// # Safety
/// As `notesage_capture_linked_document_extension`.
#[no_mangle]
pub unsafe extern "C" fn notesage_capture_disposition_filename(
    header: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        match opt_str(header).and_then(|h| filename_from_content_disposition(&h)) {
            Some(name) => into_c_string(name),
            None => std::ptr::null_mut(),
        }
    }))
    .unwrap_or(std::ptr::null_mut())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Call through the real C ABI and take ownership of the result, so the
    /// tests exercise the same path Swift will — including the free.
    unsafe fn call(
        f: unsafe extern "C" fn(
            *const c_char,
            *const c_char,
            *const c_char,
            *const c_char,
        ) -> *mut c_char,
        url: &str,
        title: Option<&str>,
        sel: Option<&str>,
        tags: Option<&str>,
    ) -> String {
        let url_c = CString::new(url).unwrap();
        let title_c = title.map(|t| CString::new(t).unwrap());
        let sel_c = sel.map(|t| CString::new(t).unwrap());
        let tags_c = tags.map(|t| CString::new(t).unwrap());
        let ptr = f(
            url_c.as_ptr(),
            title_c.as_ref().map_or(std::ptr::null(), |c| c.as_ptr()),
            sel_c.as_ref().map_or(std::ptr::null(), |c| c.as_ptr()),
            tags_c.as_ref().map_or(std::ptr::null(), |c| c.as_ptr()),
        );
        assert!(!ptr.is_null(), "FFI returned NULL");
        let out = CStr::from_ptr(ptr).to_str().unwrap().to_owned();
        notesage_capture_string_free(ptr);
        out
    }

    #[test]
    fn contents_carry_the_link_and_capture_frontmatter() {
        let out = unsafe {
            call(
                notesage_capture_contents,
                "https://example.com/a",
                Some("A Title"),
                None,
                None,
            )
        };
        assert!(out.contains("type: capture"), "{out}");
        assert!(out.contains("https://example.com/a"), "{out}");
        assert!(out.contains("title:"), "{out}");
        assert!(out.contains(r#"- "inbox""#), "default tag missing: {out}");
    }

    #[test]
    fn rel_path_lands_in_the_inbox_with_a_slug() {
        let out = unsafe {
            call(
                notesage_capture_rel_path,
                "https://example.com/a",
                Some("Hello World"),
                None,
                None,
            )
        };
        assert_eq!(out, "Inbox/Hello World.md", "{out}");
    }

    #[test]
    fn null_optionals_are_absent_not_a_crash() {
        // A share sheet can hand over a URL and nothing else.
        let out = unsafe { call(notesage_capture_contents, "https://example.com/x", None, None, None) };
        assert!(out.contains("https://example.com/x"), "{out}");
        assert!(!out.contains("title:"), "no title should be emitted: {out}");
    }

    #[test]
    fn tags_split_on_commas_and_ignore_blanks() {
        let out = unsafe {
            call(
                notesage_capture_contents,
                "https://example.com",
                None,
                None,
                Some("read-later, , research"),
            )
        };
        assert!(out.contains(r#"- "read-later""#), "{out}");
        assert!(out.contains(r#"- "research""#), "{out}");
        assert!(!out.contains(r#"- "inbox""#), "explicit tags replace the default: {out}");
    }

    #[test]
    fn selection_text_is_appended_to_the_body() {
        let out = unsafe {
            call(
                notesage_capture_contents,
                "https://example.com",
                None,
                Some("a quoted passage"),
                None,
            )
        };
        assert!(out.contains("a quoted passage"), "{out}");
    }

    #[test]
    fn freeing_null_is_a_no_op() {
        unsafe { notesage_capture_string_free(std::ptr::null_mut()) };
    }
}

#[cfg(test)]
mod x_ffi_tests {
    use super::*;
    use std::ffi::CString;

    const URL: &str = "https://x.com/rvaniaaaa/status/1234567890";
    /// What the share sheet hands over for an X status: the page chrome.
    const SHARED_TITLE: &str = "Rania (@rvaniaaaa) on X";

    fn syndication_json() -> CString {
        CString::new(
            r#"{
              "text": "https://t.co/abc",
              "user": { "name": "Rania", "screen_name": "rvaniaaaa" },
              "created_at": "2026-08-20T09:00:00Z",
              "article": {
                "title": "A community is what sharing bread means",
                "preview_text": "The opening lines of the piece.",
                "cover_media": { "media_info": { "original_img_url": "https://pbs.twimg.com/cover.jpg" } }
              }
            }"#,
        )
        .unwrap()
    }

    /// Enough prose to clear the extractor's 400-character floor.
    fn article_html() -> CString {
        let body = "This is the real body of the article, server-rendered on the status page. "
            .repeat(12);
        CString::new(format!("<html><body><article><h1>Ignored</h1><p>{body}</p></article></body></html>"))
            .unwrap()
    }

    unsafe fn take(ptr: *mut c_char) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        let s = CStr::from_ptr(ptr).to_str().unwrap().to_owned();
        notesage_capture_string_free(ptr);
        Some(s)
    }

    #[test]
    fn the_metadata_endpoint_is_offered_for_x_and_withheld_elsewhere() {
        unsafe {
            let x = CString::new(URL).unwrap();
            let endpoint = take(notesage_capture_x_metadata_url(x.as_ptr())).expect("an endpoint");
            assert!(endpoint.contains("cdn.syndication.twimg.com"), "{endpoint}");
            assert!(endpoint.contains("id=1234567890"), "{endpoint}");

            let other = CString::new("https://example.com/a").unwrap();
            assert!(notesage_capture_x_metadata_url(other.as_ptr()).is_null());
        }
    }

    #[test]
    fn the_capture_is_named_after_the_post_not_its_author() {
        // The defect this fixes: every X capture landing in the Inbox called
        // "Rania (@rvaniaaaa) on X", so a second article by the same person
        // collides and neither filename says what it holds.
        unsafe {
            let url = CString::new(URL).unwrap();
            let title = CString::new(SHARED_TITLE).unwrap();
            let json = syndication_json();
            let out = take(notesage_capture_x_rel_path(
                url.as_ptr(),
                title.as_ptr(),
                json.as_ptr(),
            ))
            .expect("a path");
            assert_eq!(out, "Inbox/A community is what sharing bread means.md", "{out}");
        }
    }

    #[test]
    fn the_cover_image_leads_the_note_so_the_gallery_card_shows_it() {
        unsafe {
            let url = CString::new(URL).unwrap();
            let title = CString::new(SHARED_TITLE).unwrap();
            let html = article_html();
            let json = syndication_json();
            let out = take(notesage_capture_x_contents(
                url.as_ptr(),
                title.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                html.as_ptr(),
                json.as_ptr(),
            ))
            .expect("contents");

            assert!(out.contains("https://pbs.twimg.com/cover.jpg"), "cover missing: {out}");
            assert!(out.contains("author_handle: \"@rvaniaaaa\""), "{out}");
            assert!(out.contains("This is the real body"), "extraction lost: {out}");
            // The cover must precede the body — `article_lead_image` takes the
            // FIRST image, and that is the whole point of prepending it.
            let cover_at = out.find("cover.jpg").unwrap();
            let body_at = out.find("This is the real body").unwrap();
            assert!(cover_at < body_at, "cover is not the lead image: {out}");
        }
    }

    #[test]
    fn a_missing_endpoint_degrades_to_the_plain_article_rather_than_failing() {
        // The syndication endpoint is undocumented and unversioned. When it
        // stops answering, an X share must still save the article — losing
        // enrichment is acceptable, losing the capture is not.
        unsafe {
            let url = CString::new(URL).unwrap();
            let html = article_html();
            let out = take(notesage_capture_x_contents(
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                html.as_ptr(),
                std::ptr::null(), // no metadata
            ))
            .expect("contents even with no metadata");
            assert!(out.contains("This is the real body"), "{out}");
            assert!(out.contains("type: capture"), "{out}");
        }
    }

    #[test]
    fn a_post_with_no_article_still_yields_a_note() {
        // A plain post has nothing to extract — that is the normal case, not a
        // failure, and it is what the fallback builder is for.
        unsafe {
            let url = CString::new(URL).unwrap();
            let json = CString::new(
                r#"{"text":"a short post","user":{"name":"Rania","screen_name":"rvaniaaaa"}}"#,
            )
            .unwrap();
            let out = take(notesage_capture_x_contents(
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(), // no html at all
                json.as_ptr(),
            ))
            .expect("the metadata note");
            assert!(out.contains("capture_format: x-post"), "{out}");
            assert!(out.contains("a short post"), "{out}");
        }
    }

    #[test]
    fn the_html_format_declines_when_there_is_no_article() {
        // Unlike the markdown path, an HTML document with no article in it is
        // not worth writing — NULL tells Swift to try the next fallback.
        unsafe {
            let url = CString::new(URL).unwrap();
            let json = syndication_json();
            let ptr = notesage_capture_x_html_contents(
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                json.as_ptr(),
            );
            assert!(ptr.is_null(), "should decline with no html");
        }
    }

    #[test]
    fn the_html_document_carries_the_real_title_and_the_cover() {
        unsafe {
            let url = CString::new(URL).unwrap();
            let title = CString::new(SHARED_TITLE).unwrap();
            let html = article_html();
            let json = syndication_json();
            let out = take(notesage_capture_x_html_contents(
                url.as_ptr(),
                title.as_ptr(),
                html.as_ptr(),
                json.as_ptr(),
            ))
            .expect("a document");
            assert!(
                out.contains("<title>A community is what sharing bread means</title>"),
                "page chrome leaked into the title: {out}"
            );
            assert!(out.contains("<img src=\"https://pbs.twimg.com/cover.jpg\""), "{out}");
        }
    }

    #[test]
    fn garbage_json_is_treated_as_absent_not_as_a_crash() {
        unsafe {
            let url = CString::new(URL).unwrap();
            let html = article_html();
            let junk = CString::new("<html>429 Too Many Requests</html>").unwrap();
            let out = take(notesage_capture_x_contents(
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                html.as_ptr(),
                junk.as_ptr(),
            ))
            .expect("contents");
            assert!(out.contains("This is the real body"), "{out}");
        }
    }
}

#[cfg(test)]
mod html_title_tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn a_url_shared_as_the_title_falls_back_to_the_pages_og_title() {
        let url = CString::new("https://youtu.be/3zk1WjrxCSw").unwrap();
        // What YouTube's share sheet actually hands over.
        let title = CString::new("https://youtu.be/3zk1WjrxCSw").unwrap();
        let html = CString::new(
            r#"<html><head><meta property="og:title" content="A zseni, aki mindent hagyott"></head></html>"#,
        )
        .unwrap();
        let out = unsafe {
            let ptr = notesage_capture_rel_path_from_html(
                url.as_ptr(),
                title.as_ptr(),
                html.as_ptr(),
            );
            assert!(!ptr.is_null());
            let s = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            notesage_capture_string_free(ptr);
            s
        };
        assert_eq!(out, "Inbox/A zseni, aki mindent hagyott.md", "{out}");
    }

    #[test]
    fn a_real_shared_title_still_wins_over_the_pages_metadata() {
        let url = CString::new("https://example.com/a").unwrap();
        let title = CString::new("What the user shared").unwrap();
        let html = CString::new(r#"<head><meta property="og:title" content="Page says"></head>"#)
            .unwrap();
        let out = unsafe {
            let ptr =
                notesage_capture_rel_path_from_html(url.as_ptr(), title.as_ptr(), html.as_ptr());
            let s = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            notesage_capture_string_free(ptr);
            s
        };
        assert_eq!(out, "Inbox/What the user shared.md", "{out}");
    }
}
