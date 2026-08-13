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
    build_article_note, build_capture_note, extract_article, extract_meta_title, meaningful_title,
    timestamps, CaptureInput,
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
