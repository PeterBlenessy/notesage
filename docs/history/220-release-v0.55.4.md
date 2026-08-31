# Release v0.55.4

**Date:** 2026-08-31
**Previous version:** 0.55.3

Articles you save now look like the article: the picture at the top, who wrote
it, when, and the one-line summary — not just the text.

## Changes

### Fixes

- **Saved articles keep their picture, author and date.** A saved article used
  to arrive as the words alone: the lead picture, the author, the date and the
  one-line summary under the headline were all dropped, so it read as a wall of
  text rather than the page you saved. They are all kept now, laid out the way a
  reading app lays them out. The gallery card also shows the article's own lead
  picture instead of whichever screenshot happened to come first in the text —
  the same cause, so it is fixed by the same change.

## Under the hood

- Root cause was single: the readable-article extractor picks ONE winning
  content node — the body — and a blog's hero image, author and date almost
  always live in the page HEADER, outside it. `build_article_html_document`
  rendered `heading + body + source footer`, discarding the masthead on every
  site with that layout. Every missing field was already exposed by
  `dom_smoothie`'s `Article` (`byline`, `published_time`, `image`, `site_name`,
  `excerpt`) and simply never read.
- The document now opens with title → standfirst → `By … · date · n min read ·
  site` → hero. The hero is absolutised (`og:image` is usually root-relative,
  and a relative src in a file opened from disk resolves to nothing), emitted
  only when the body does not already carry it, and the standfirst is suppressed
  when it merely repeats the body's opening — readability falls back to the
  first sentence when a page declares no description.
- The thumbnail fix is a consequence rather than separate work: the hero is now
  first in document order, so the image sweep inlines it first and
  `article_lead_image` finds it.
- The title is deliberately unchanged. The site suffix ("… - OpenClaw Blog")
  was initially called a defect; Instapaper keeps it and the reference the
  report was measured against shows it, so it stays.
- Why it survived: every existing test asked WHETHER an article was captured,
  never WHAT the capture looked like. Five tests added against a fixture with
  the masthead outside the content div, all four behaviours mutation-tested.
- Articles already in the library are unchanged — the header was never written
  to disk, so restoring it means going back to the source page. Tracked in #829,
  which explains why an on-open repair (as used for #805) cannot work here.

## Files Changed

- 2 files across 1 commit (PR #828)
