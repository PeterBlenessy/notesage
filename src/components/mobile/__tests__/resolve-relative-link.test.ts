// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect } from "vitest";
import { resolveRelativeLink } from "@/components/mobile/Reader";

describe("resolveRelativeLink", () => {
  it("resolves a sibling file against the current document's directory", () => {
    expect(resolveRelativeLink("Inbox/note.md", "other.md")).toBe("Inbox/other.md");
  });

  it("resolves a parent traversal", () => {
    expect(resolveRelativeLink("a/b/note.md", "../c.md")).toBe("a/c.md");
  });

  it("refuses to escape the library root", () => {
    expect(resolveRelativeLink("note.md", "../../etc/passwd")).toBeNull();
  });

  /**
   * The bug behind "tapping an anchor in a report does nothing".
   *
   * A report is loaded with `loadHTMLString(baseURL: nil)`, so its base is
   * `about:blank` and WebKit resolves `href="#top"` to `about:blank#top`
   * before the app ever sees it. That is not a remote url, so the reader fell
   * through to this function, which stripped the fragment and joined what was
   * left onto the current directory — producing `Inbox/about:blank`, a library
   * path to a file that cannot exist. Opening it failed quietly, so the tap
   * looked ignored rather than broken.
   *
   * Any scheme, not just `about:` — a path is never something with a scheme.
   */
  it.each(["about:blank#top", "about:blank", "data:text/html,x", "javascript:void(0)", "file:///etc/passwd"])(
    "returns null for %s rather than fabricating a library path",
    (href) => {
      expect(resolveRelativeLink("Inbox/report.html", href)).toBeNull();
    },
  );

  /**
   * `notes:` is scheme-shaped, so a bare `notes: draft.md` is rejected — and
   * that is correct rather than a limitation. A browser resolving that href
   * reaches the same conclusion: RFC 3986 makes a first segment containing a
   * colon ambiguous with a scheme, which is exactly why the relative form has
   * to be written `./notes: draft.md`. Agreeing with WebKit matters more here
   * than accepting an unusual filename, since WebKit is what resolves the href
   * before this function ever sees it.
   */
  it("treats a scheme-shaped first segment as a scheme, as a browser does", () => {
    expect(resolveRelativeLink("Inbox/a.md", "notes: draft.md")).toBeNull();
  });

  it("resolves the same filename when written explicitly relative", () => {
    expect(resolveRelativeLink("Inbox/a.md", "./notes: draft.md")).toBe("Inbox/notes: draft.md");
  });
});
