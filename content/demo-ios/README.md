# iOS demo content

Fictional saved articles for the iOS marketing screenshots (#593). Everything
here is invented — no real publications, authors or URLs — because these end up
in the App Store listing and on the website. The hosts are all `.example`,
which is reserved by RFC 2606 and can never resolve.

The notes come from `content/demo/`, shared with the desktop screenshots. What
lives here is the thing the desktop demo has none of: **saved articles**. They
are what makes an iOS screenshot look like Notesage rather than a file browser
— the row draws the article's own title, its site and its reading time, and the
reader shows the piece.

## Why these are real captures, not mock-ups

Each file is the exact shape the capture pipeline writes: a `<title>`, a
`<p class="standfirst">`, a `<p class="byline">` carrying `N min read · site`,
and a `<p class="source">Clipped from …</p>` footer. That is what
`notesage_capture::article_card_meta` reads back, so the app treats them as
genuine captures and the rows populate for real. A mock-up that only looked
right in a screenshot would drift the moment the format changed; these fail
loudly instead, because the parser is the same one the product uses.

Verified by running them through that parser — title, site, minutes and
standfirst all extracted.

## Regenerating

The hero images are flat colours generated in the script rather than shipped as
binaries, so the whole folder stays diffable text.

    python3 scripts/make-demo-captures.py     # rewrites the three files

## Using them

    scripts/seed-ios-demo-library.sh --list <UDID>
    scripts/seed-ios-demo-library.sh <UDID> <granted-library-path>
    scripts/seed-ios-demo-library.sh --restore <granted-library-path>

The app reaches its library through a security-scoped bookmark, so a fresh
folder cannot simply be pointed at — the script writes into the folder already
granted and keeps a `.backup` alongside.
