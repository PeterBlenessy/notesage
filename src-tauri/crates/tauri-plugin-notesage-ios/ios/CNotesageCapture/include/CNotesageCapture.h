//
//  CNotesageCapture.h
//  The `notesage-capture` C ABI, as the PLUGIN package sees it.
//
//  Why this exists at all. The app/extension target has its own bridging
//  header (`src-tauri/ios/NotesageCapture.h`) and links
//  `libnotesage_capture.a` directly — that is the Share Extension's route,
//  and it runs in a different process. The plugin's Swift Package has
//  neither, so `ArticleMeta.swift` calling the C function straight out of the
//  air failed the real build even though a bridging header made it pass the
//  type-check (2026-09-11).
//
//  It turned out the STATIC LIBRARY was never the obstacle. The app's Rust
//  library depends on the `notesage-capture` crate, and its `#[no_mangle]`
//  exports survive into `libtauri_app_lib.a` — all twenty of them, verified
//  with `nm -gU`. The app target already links that archive, so the symbol is
//  there at link time; the archive member is pulled in precisely because
//  Swift references it. What was missing was only a DECLARATION the package
//  is allowed to see.
//
//  Hence a C target of its own, with no implementation: `shim.c` is empty on
//  purpose. SwiftPM turns this directory into a module the Swift target can
//  `import`, and the definitions arrive from the Rust archive at final link.
//
//  Kept deliberately narrow — two functions, not twenty. Everything else in
//  the C ABI belongs to capture, which happens in the extension's process and
//  has no business being reachable from a folder screen.
//

#ifndef C_NOTESAGE_CAPTURE_H
#define C_NOTESAGE_CAPTURE_H

#ifdef __cplusplus
extern "C" {
#endif

/// A saved article's list-row fields as JSON — `{ "title", "excerpt",
/// "minutes", "site", "sourceUrl" }`, each nullable — or NULL when the
/// document is not one of our captures (#1000).
///
/// Caller frees with notesage_capture_string_free().
char *notesage_capture_article_card_meta(const char *html);

/// Release a string returned above. Passing NULL is a no-op.
void notesage_capture_string_free(char *ptr);

#ifdef __cplusplus
}
#endif

#endif /* C_NOTESAGE_CAPTURE_H */
