# Release v0.55.1

**Date:** 2026-08-29
**Previous version:** 0.55.0

Two fixes to saving. Any kind of file shared from Finder now reaches your
Inbox, and articles saved from a web page keep their formatting.

## Changes

### Fixes

- **Any file you share from Finder now saves.** "Share → Notesage" from Finder
  worked for PDFs, ebooks, images, video and audio, and failed for everything
  else — a saved web page, a Word document, a presentation, a spreadsheet, a
  text or Markdown file. Those shares did not save the wrong thing; they saved
  nothing at all. Every file type lands in your Inbox now, under its own name.
- **Saved articles keep their formatting.** Some articles saved from a web page
  opened with the wrong text size and spacing, most noticeably on iPhone.
  Whether it happened depended on the pictures in the article, so two articles
  saved minutes apart could come out differently. Articles saved from now on
  are correct. Ones already in your library keep the formatting they were saved
  with — repairing those is coming separately.

## Under the hood

- **#805.** `inline_article_images` parsed with `dom_query::Document::fragment`
  and re-serialized. Fragment mode sets html5ever's `drop_doctype`, so the
  sweep stripped `<!doctype html>` (and the optional `<head>`/`<body>` tags)
  from a document `build_article_html_document` had emitted correctly — the
  builder was never at fault, and the test asserting its output passed
  throughout. Now `Document::from` (`parse_document`). Symptom was quirks mode,
  `document.compatMode === "BackCompat"`. Inconsistent within a single batch
  because only documents whose images were actually inlined get rewritten;
  `map.is_empty()` returns early.
- **#817.** macOS `documentTypeIdentifiers` held five media types and not
  `public.file-url`, so every other file missed the document branch, fell
  through to the link branch — which does accept `public.file-url` — and was
  rejected by `ShareCapture.save`'s http(s)-only scheme guard as `badUrl`. The
  share failed outright rather than saving the wrong thing. Detection is now
  split from load-representation preference, mirroring iOS, which was already
  correct; the macOS comment claimed parity that did not exist and that nothing
  checked.
- Three guards added to `pipeline_contract.rs`, each mutation-tested. The first
  file-share guard passed with the fix reverted — both platforms also list
  `public.file-url` among their link types, so a whole-file check was satisfied
  by the wrong branch. It now brace-matches the deciding block, over
  comment-stripped source. The #805 guard runs the real extract → build → sweep
  chain, because the bug lived between steps that were each correct alone.
- Not verified on a running macOS build: that needs the app rebuilt and the
  share extension re-embedded. `cargo check --workspace --all-targets` and
  `swiftc -typecheck` against the real bridging header are clean.

## Files Changed

- 3 files across 2 commits (PR #818)
