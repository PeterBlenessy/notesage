import { describe, it, expect } from "vitest";
import {
  basename,
  parentDir,
  resolveRenamePath,
  validateRenameBasename,
} from "../rename-utils";

describe("basename", () => {
  it("returns the last segment of an absolute path", () => {
    expect(basename("/a/b/c.md")).toBe("c.md");
    expect(basename("/a/b/c")).toBe("c");
  });
  it("handles trailing slashes", () => {
    expect(basename("/a/b/c/")).toBe("c");
  });
  it("returns the path itself for single-segment inputs", () => {
    expect(basename("foo.md")).toBe("foo.md");
  });
});

describe("parentDir", () => {
  it("returns the parent of an absolute path", () => {
    expect(parentDir("/a/b/c.md")).toBe("/a/b");
  });
  it("returns empty string for top-level absolute paths", () => {
    expect(parentDir("/c.md")).toBe("");
  });
});

describe("resolveRenamePath", () => {
  it("uses the user's input verbatim when it carries an extension", () => {
    expect(resolveRenamePath("/a/old.md", "new.md")).toBe("/a/new.md");
    expect(resolveRenamePath("/a/old.md", "new.txt")).toBe("/a/new.txt");
  });
  it("preserves the original extension when the user omits one", () => {
    expect(resolveRenamePath("/a/old.md", "new")).toBe("/a/new.md");
    expect(resolveRenamePath("/a/old.txt", "report")).toBe("/a/report.txt");
  });
  it("keeps the parent directory stable", () => {
    expect(resolveRenamePath("/root/deep/nested/f.md", "g.md")).toBe(
      "/root/deep/nested/g.md",
    );
  });
  it("handles files without extensions", () => {
    expect(resolveRenamePath("/a/README", "TODO")).toBe("/a/TODO");
  });
  it("treats dotfiles as extensionless (their leading dot is NOT an extension)", () => {
    // `.env` has no real extension — input `newname` should NOT get `.env`
    // appended. The rule: if the new name has no dot after the first char,
    // preserve the old ext; `.env`'s "extension" is the whole name, so we
    // fall through to plain rename.
    expect(resolveRenamePath("/a/.env", "newname")).toBe("/a/newname");
  });
});

describe("resolveRenamePath with isDirectory flag", () => {
  it("skips extension carry-over for directories (isDirectory=true)", () => {
    expect(resolveRenamePath("/parent/my.config", "new-name", true)).toBe(
      "/parent/new-name",
    );
  });
  it("honours explicit extension even for directories (isDirectory=true)", () => {
    expect(resolveRenamePath("/parent/my.config", "new-name.txt", true)).toBe(
      "/parent/new-name.txt",
    );
  });
  it("preserves file extension when isDirectory=false", () => {
    expect(resolveRenamePath("/parent/notes.md", "new-name", false)).toBe(
      "/parent/new-name.md",
    );
  });
  it("uses file behaviour when flag is omitted", () => {
    expect(resolveRenamePath("/parent/my.config", "new-name")).toBe(
      "/parent/new-name.config",
    );
  });
});

describe("validateRenameBasename", () => {
  it("returns null for empty input (SidebarInlineEdit cancels it)", () => {
    expect(validateRenameBasename("")).toBeNull();
    expect(validateRenameBasename("   ")).toBeNull();
  });
  it("returns null for valid input", () => {
    expect(validateRenameBasename("foo.md")).toBeNull();
    expect(validateRenameBasename("My File")).toBeNull();
  });
  it("rejects slashes in the input", () => {
    expect(validateRenameBasename("foo/bar.md")).toMatch(/slash/i);
    expect(validateRenameBasename("/absolute.md")).toMatch(/slash/i);
  });
});
