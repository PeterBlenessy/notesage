import { describe, it, expect } from "vitest";
import { injectFindScript, HTML_FIND_NS } from "../html-find-frame";

describe("injectFindScript", () => {
  it("injects the find script just before </body>", () => {
    const html = "<!DOCTYPE html><html><head></head><body><p>hi</p></body></html>";
    const out = injectFindScript(html);
    expect(out).toContain("<script>");
    // Script must land inside the body, before the closing tag.
    const scriptIdx = out.indexOf("<script>");
    const bodyCloseIdx = out.toLowerCase().lastIndexOf("</body>");
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(bodyCloseIdx);
    // The script references the shared message namespace.
    expect(out).toContain(HTML_FIND_NS);
    // Original content is preserved.
    expect(out).toContain("<p>hi</p>");
  });

  it("appends the script when there is no </body>", () => {
    const html = "<div>fragment</div>";
    const out = injectFindScript(html);
    expect(out.startsWith("<div>fragment</div>")).toBe(true);
    expect(out).toContain("<script>");
    expect(out).toContain(HTML_FIND_NS);
  });

  it("is case-insensitive about the closing body tag", () => {
    const html = "<body><p>x</p></BODY>";
    const out = injectFindScript(html);
    const scriptIdx = out.indexOf("<script>");
    const bodyCloseIdx = out.toLowerCase().lastIndexOf("</body>");
    expect(scriptIdx).toBeLessThan(bodyCloseIdx);
  });
});
