import { describe, it, expect } from "vitest";
import { inboxDir, inboxMetaDir, recordingsDir, resolveNotesRoot } from "@/lib/notes-root";

describe("resolveNotesRoot", () => {
  it("expands a leading tilde against the home directory, and only that", () => {
    expect(resolveNotesRoot("~/Notesage", "/Users/peter")).toBe("/Users/peter/Notesage");
    expect(resolveNotesRoot("~/Notesage/", "/Users/peter/")).toBe("/Users/peter/Notesage");
    expect(resolveNotesRoot("~", "/Users/peter")).toBe("/Users/peter");
    expect(resolveNotesRoot("/Volumes/Notes/~/x", "/Users/peter")).toBe("/Volumes/Notes/~/x");
  });

  it("is null while the home directory is unknown", () => {
    expect(resolveNotesRoot("~/Notesage", null)).toBeNull();
    expect(resolveNotesRoot("", "/Users/peter")).toBeNull();
    expect(resolveNotesRoot("/abs/path", null)).toBe("/abs/path");
  });

  it("names the Inbox and its metadata folder under the root", () => {
    expect(inboxDir("/Users/peter/Notesage")).toBe("/Users/peter/Notesage/Inbox");
    expect(inboxMetaDir("/Users/peter/Notesage/")).toBe("/Users/peter/Notesage/Inbox/.notesage");
  });

  it("names the Recordings folder under the same root the Inbox uses", () => {
    expect(recordingsDir("/Users/peter/Notesage")).toBe("/Users/peter/Notesage/Recordings");
    expect(recordingsDir("/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/Notesage/")).toBe(
      "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/Notesage/Recordings",
    );
  });
});
