import { describe, it, expect } from "vitest";
import { resolveLocalScriptPath } from "../html-local-script";

describe("resolveLocalScriptPath (audit 2026-11-22 §6)", () => {
  const dir = "/Users/me/site";

  it("resolves a script next to the HTML file", () => {
    expect(resolveLocalScriptPath(dir, "./app.js")).toBe("/Users/me/site/app.js");
  });

  it("resolves a script in a subdirectory", () => {
    expect(resolveLocalScriptPath(dir, "./js/vendor/app.js")).toBe("/Users/me/site/js/vendor/app.js");
    expect(resolveLocalScriptPath(dir, "././js//app.js")).toBe("/Users/me/site/js/app.js");
  });

  it.each([
    "./../secret.js",
    "./../../../.ssh/id_rsa",
    "./js/../../secret.js",
    // Stays inside lexically, but would escape through a symlinked `js`.
    "./js/../app.js",
    "./..",
  ])("refuses to climb out of the directory: %s", (src) => {
    expect(resolveLocalScriptPath(dir, src)).toBeNull();
  });

  it.each(["/etc/passwd", "app.js", "../app.js", "https://example.com/a.js", "./", "./a.js?x=1", "./a\\..\\b.js"])(
    "refuses anything that is not a plain ./ path: %s",
    (src) => {
      expect(resolveLocalScriptPath(dir, src)).toBeNull();
    },
  );

  it("refuses a relative base directory", () => {
    expect(resolveLocalScriptPath("", "./app.js")).toBeNull();
  });
});
