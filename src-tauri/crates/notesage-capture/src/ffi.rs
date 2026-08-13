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
    build_capture_note, build_capture_note_from_html, build_video_html_note, timestamps,
    CaptureInput,
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

/// Build an ARTICLE capture note's **file contents** from fetched page HTML
/// (rich web capture, #584): readable extraction + HTML→Markdown + the v2
/// note format (`capture_format: markdown`). A detected video page (#682)
/// becomes a link-style note (`capture_format: video-link`) instead of
/// embedding the page's play-button-overlaid poster image as ordinary
/// content.
///
/// Returns NULL when the page is neither a video page nor yields a genuine
/// article (nav-heavy page, near-empty body, non-HTML) — the caller falls
/// back to the link-only note — or on panic. Free with
/// [`notesage_capture_string_free`].
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
        let (now, _stamp) = timestamps();
        match build_capture_note_from_html(&input, &html, &now) {
            Some(note) => into_c_string(note.contents),
            None => std::ptr::null_mut(),
        }
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Build a link-style HTML document for the Page/HTML capture format when
/// `url`/`html` is a detected video page (#682) — presenting the item as a
/// clear "Open on \<source\>" link instead of the raw fetched page, whose
/// player never actually renders once scripts are stripped by the HTML
/// viewer's default sandboxed rendering (leaving only the inert poster).
///
/// Returns NULL when the page is not a detected video page — the caller
/// keeps writing the raw fetched HTML unchanged — or on panic. Free with
/// [`notesage_capture_string_free`].
///
/// # Safety
/// All pointers must be NUL-terminated C strings or NULL, valid for the call.
#[no_mangle]
pub unsafe extern "C" fn notesage_capture_video_html(
    url: *const c_char,
    title: *const c_char,
    html: *const c_char,
) -> *mut c_char {
    catch_unwind(AssertUnwindSafe(|| {
        let url = match opt_str(url) {
            Some(u) => u,
            None => return std::ptr::null_mut(),
        };
        let html = match opt_str(html) {
            Some(h) => h,
            None => return std::ptr::null_mut(),
        };
        let input = CaptureInput { url, title: opt_str(title), ..CaptureInput::default() };
        match build_video_html_note(&input, &html) {
            Some(doc) => into_c_string(doc),
            None => std::ptr::null_mut(),
        }
    }))
    .unwrap_or(std::ptr::null_mut())
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

    // ---- video-page link-style capture (#682) ------------------------------

    fn video_page_html() -> &'static str {
        "<html><head><title>Great Video</title></head><body>\
         <nav><a href=\"/\">Home</a><a href=\"/about\">About</a></nav>\
         <article><h1>Great Video</h1>\
         <img src=\"https://i.ytimg.com/vi/abc123/maxresdefault.jpg\" width=\"1280\" height=\"720\" alt=\"Play video\">\
         <p>Paragraph 0: the quick brown fox jumps over the lazy dog, again and again, providing ample readable content.</p>\
         <p>Paragraph 1: the quick brown fox jumps over the lazy dog, again and again, providing ample readable content.</p>\
         </article><footer>© footer</footer></body></html>"
    }

    #[test]
    fn article_contents_ffi_returns_link_style_note_for_video_pages() {
        let url = CString::new("https://www.youtube.com/watch?v=abc123").unwrap();
        let html = CString::new(video_page_html()).unwrap();
        let ptr = unsafe {
            notesage_capture_article_contents(
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                html.as_ptr(),
            )
        };
        assert!(!ptr.is_null(), "FFI returned NULL for a detected video page");
        let out = unsafe {
            let s = CStr::from_ptr(ptr).to_str().unwrap().to_owned();
            notesage_capture_string_free(ptr);
            s
        };
        assert!(!out.contains("maxresdefault.jpg"), "{out}");
        assert!(out.contains("Open on YouTube"), "{out}");
    }

    #[test]
    fn video_html_ffi_returns_link_style_document_for_video_pages() {
        let url = CString::new("https://www.youtube.com/watch?v=abc123").unwrap();
        let html = CString::new(video_page_html()).unwrap();
        let ptr = unsafe {
            notesage_capture_video_html(url.as_ptr(), std::ptr::null(), html.as_ptr())
        };
        assert!(!ptr.is_null(), "FFI returned NULL for a detected video page");
        let out = unsafe {
            let s = CStr::from_ptr(ptr).to_str().unwrap().to_owned();
            notesage_capture_string_free(ptr);
            s
        };
        assert!(!out.contains("maxresdefault.jpg"), "{out}");
        assert!(out.contains("Open on YouTube"), "{out}");
    }

    #[test]
    fn video_html_ffi_returns_null_for_non_video_pages() {
        let url = CString::new("https://example.com/post").unwrap();
        let html = CString::new(
            "<html><head><title>Article</title></head><body><article><h1>Article</h1>\
             <p>Paragraph 0: the quick brown fox jumps over the lazy dog, again and again, providing ample readable content.</p>\
             <p>Paragraph 1: the quick brown fox jumps over the lazy dog, again and again, providing ample readable content.</p>\
             </article></body></html>",
        )
        .unwrap();
        let ptr = unsafe {
            notesage_capture_video_html(url.as_ptr(), std::ptr::null(), html.as_ptr())
        };
        assert!(ptr.is_null(), "expected NULL (not a video page) so the caller keeps the raw HTML");
    }
}
