import { describe, it, expect } from "vitest";

import { resolveCreateParent } from "@/lib/workspace/resolve-create-parent";
import type { WorkspaceProject } from "@/stores/workspace-store";

const projects: WorkspaceProject[] = [
  { path: "/Users/me/Notesage/alpha", fileTree: [] },
  { path: "/Users/me/Notesage/beta", fileTree: [] },
];

describe("resolveCreateParent", () => {
  it("returns the active file's parent dir when inside a project", () => {
    expect(
      resolveCreateParent("/Users/me/Notesage/alpha/notes/a.md", projects),
    ).toBe("/Users/me/Notesage/alpha/notes");
  });

  it("returns the project root when the file sits directly in the project", () => {
    expect(resolveCreateParent("/Users/me/Notesage/alpha/a.md", projects)).toBe(
      "/Users/me/Notesage/alpha",
    );
  });

  it("returns null when no projects are open", () => {
    expect(resolveCreateParent("/Users/me/Notesage/alpha/a.md", [])).toBeNull();
  });

  it("returns null when the active file is outside every project", () => {
    expect(
      resolveCreateParent("/Users/me/elsewhere/a.md", projects),
    ).toBeNull();
  });

  it("returns null when there is no active file", () => {
    expect(resolveCreateParent(null, projects)).toBeNull();
  });
});
