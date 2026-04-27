import { describe, it, expect } from "vitest";
import { canonicalizeMacPath } from "@/lib/path-utils";

describe("canonicalizeMacPath (sidebar-simplification task #8)", () => {
  it("strips /private prefix from /var paths (the most common macOS collision)", () => {
    expect(canonicalizeMacPath("/private/var/folders/abc/def")).toBe(
      "/var/folders/abc/def",
    );
  });

  it("strips /private prefix from /tmp paths", () => {
    expect(canonicalizeMacPath("/private/tmp/notesage-test")).toBe(
      "/tmp/notesage-test",
    );
  });

  it("strips /private prefix from /etc paths", () => {
    expect(canonicalizeMacPath("/private/etc/hosts")).toBe("/etc/hosts");
  });

  it("normalises bare /private/var, /private/tmp, /private/etc roots", () => {
    expect(canonicalizeMacPath("/private/var")).toBe("/var");
    expect(canonicalizeMacPath("/private/tmp")).toBe("/tmp");
    expect(canonicalizeMacPath("/private/etc")).toBe("/etc");
  });

  it("leaves user paths unchanged", () => {
    expect(canonicalizeMacPath("/Users/peter/notes")).toBe(
      "/Users/peter/notes",
    );
    expect(canonicalizeMacPath("/Users/peter/Notesage/Project")).toBe(
      "/Users/peter/Notesage/Project",
    );
  });

  it("leaves already-canonical /var, /tmp, /etc paths unchanged", () => {
    expect(canonicalizeMacPath("/var/foo")).toBe("/var/foo");
    expect(canonicalizeMacPath("/tmp/bar")).toBe("/tmp/bar");
    expect(canonicalizeMacPath("/etc/hosts")).toBe("/etc/hosts");
  });

  it("doesn't strip /private when the next segment isn't var/tmp/etc", () => {
    // Hypothetical user folder named "private" — must NOT be touched.
    expect(canonicalizeMacPath("/Users/private/notes")).toBe(
      "/Users/private/notes",
    );
    expect(canonicalizeMacPath("/private/other/path")).toBe(
      "/private/other/path",
    );
  });

  it("is idempotent — calling twice gives the same result", () => {
    const cases = [
      "/private/var/x",
      "/Users/peter/foo",
      "/private/tmp",
      "/var/y",
    ];
    for (const c of cases) {
      const once = canonicalizeMacPath(c);
      const twice = canonicalizeMacPath(once);
      expect(twice).toBe(once);
    }
  });
});
