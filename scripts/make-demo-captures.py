#!/usr/bin/env python3
"""Generate the fictional demo captures in content/demo-ios/Inbox.

The shape matches what the capture pipeline writes, so
`notesage_capture::article_card_meta` reads them back as genuine captures —
see content/demo-ios/README.md for why that matters.
"""
import pathlib, base64, zlib, struct

OUT = pathlib.Path("content/demo-ios/Inbox")

def png(w, h, rgb):
    """A flat-colour PNG, generated rather than shipped as a binary blob."""
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))

STYLE = (":root{color-scheme:light dark}"
         "body{margin:0 auto;padding:2.5rem 1.25rem;max-width:38rem;"
         "font:1.0625rem/1.7 -apple-system,system-ui,sans-serif}"
         "h1{font-size:1.9rem;line-height:1.2;margin:0 0 .6rem}"
         ".standfirst{font-size:1.15rem;opacity:.8;margin:0 0 .8rem}"
         ".byline{font-size:.9rem;opacity:.6;margin:0 0 1.6rem}"
         ".hero{width:100%;border-radius:12px;margin:0 0 1.8rem}"
         "figure{margin:1.8rem 0}"
         "hr{border:0;border-top:1px solid rgba(128,128,128,.3);margin:2.5rem 0 1.2rem}"
         ".endnote,.source{font-size:.85rem;opacity:.6;margin:.3rem 0}")

def capture(name, title, site, minutes, standfirst, url, hero_rgb, paragraphs):
    hero = base64.b64encode(png(1200, 630, hero_rgb)).decode()
    body = "".join(f"<p>{p}</p>" for p in paragraphs)
    html = (
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        f"<title>{title}</title><style>{STYLE}</style></head><body>"
        f"<h1>{title}</h1>"
        f"<p class=\"standfirst\">{standfirst}</p>"
        f"<p class=\"byline\">{minutes} min read · {site}</p>"
        f"<img class=\"hero\" src=\"data:image/png;base64,{hero}\">"
        f"{body}"
        f"<hr><p class=\"endnote\">{minutes} min read · {site}</p>"
        f"<p class=\"source\">Clipped from <a href=\"{url}\">{url}</a></p>"
        "</body></html>")
    (OUT / name).write_text(html, encoding="utf-8")
    return name

capture("2026-09-02-081500-the-quiet-hours.html",
  "The Quiet Hours: why deep work resists scheduling",
  "themargin.example", 6,
  "Calendars are good at reserving time and bad at protecting attention. A look at what the difference costs, and what a few writers do instead.",
  "https://themargin.example/essays/the-quiet-hours",
  (0x2E, 0x4A, 0x62),
  ["Every productivity system eventually proposes the same remedy: block the time. Put it in the calendar, defend it, and the work will follow. It rarely does.",
   "The reason is not weakness of will. A calendar reserves a slot; it cannot reserve the state of mind that makes the slot useful. Attention has a warm-up cost, and an hour interrupted at minute twenty is not forty minutes of work.",
   "Writers who manage it tend to protect something else instead — the hour before anyone else is awake, a walk with a notebook, a desk that faces a wall. They protect the conditions, and let the time arrange itself.",
   "That is an unsatisfying answer for anyone selling a method, which may be why it is so seldom the one offered."])

capture("2026-09-04-193000-notes-that-answer-back.html",
  "Notes that answer back",
  "fieldnotes.example", 4,
  "A short argument for writing notes you expect to reread, and the small formatting habits that make rereading bearable.",
  "https://fieldnotes.example/notes-that-answer-back",
  (0x5B, 0x3E, 0x2E),
  ["Most notes are written for the person writing them, at the moment of writing. That person knows the context, remembers the meeting, and does not need the sentence finished.",
   "The reader six months later is a stranger with none of that. Writing for the stranger costs perhaps ten extra seconds a note: a first line that says what this is, a date, a link back to wherever it came from.",
   "The return is that the archive stops being a graveyard. Notes you can reread are notes you will reread, and an idea revisited twice is worth more than two ideas filed once."])

capture("2026-09-07-114500-reading-on-purpose.html",
  "Reading on purpose",
  "slowweb.example", 8,
  "Saving an article is not reading it. On the quiet arithmetic of a reading list, and how to keep one that does not accuse you.",
  "https://slowweb.example/reading-on-purpose",
  (0x3A, 0x5A, 0x44),
  ["A reading list grows faster than anyone reads. This is not a personal failing; it is arithmetic. Saving takes a second and reading takes twenty minutes, so any list left alone tends toward infinity.",
   "The usual fix is guilt, which does not work, or bankruptcy — delete everything and start again — which works once.",
   "A better habit is to read the list, not the articles: once a week, open it and decide what is still interesting. Most things are not, and admitting so is quick. What survives two passes is usually worth the twenty minutes."])

print("wrote", len(list(OUT.glob("*.html"))), "captures")
