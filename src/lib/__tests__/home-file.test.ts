import { describe, it, expect } from "vitest";
import {
  applyHomeChange,
  defaultHomeFolders,
  HOME_KEY,
  isHomeCandidate,
  parseHomeFileContent,
  serializeHomeFileContent,
} from "@/lib/home-file";
import type { FileEntry } from "@/lib/tauri";

const dir = (name: string): FileEntry => ({ name, path: name, is_directory: true, hidden: false });
const file = (name: string): FileEntry => ({ name, path: name, is_directory: false, hidden: false });

describe("home.json — the folders the phone shows on Home", () => {
  it("round-trips, deduped, in a shape the Mac could read later", () => {
    const text = serializeHomeFileContent(["Inbox", "Reading"]);
    expect(text).toBe('{\n  "version": 1,\n  "folders": [\n    "Inbox",\n    "Reading"\n  ]\n}\n');
    expect(parseHomeFileContent(text)).toEqual(["Inbox", "Reading"]);
    expect(parseHomeFileContent('{"version":1,"folders":["A","A",3,"",null,"B"]}')).toEqual(["A", "B"]);
  });

  it("is null — defaults apply — for junk, the wrong shape, or another version", () => {
    expect(parseHomeFileContent("nope")).toBeNull();
    expect(parseHomeFileContent("[]")).toBeNull();
    expect(parseHomeFileContent('{"folders":["A"]}')).toBeNull();
    expect(parseHomeFileContent('{"version":2,"folders":["A"]}')).toBeNull();
    expect(parseHomeFileContent('{"version":1,"folders":"A"}')).toBeNull();
    // An empty list is a choice, not a missing file.
    expect(parseHomeFileContent('{"version":1,"folders":[]}')).toEqual([]);
  });

  it("defaults to the Inbox alone, or nothing when there is no Inbox", () => {
    expect(defaultHomeFolders([dir("Inbox"), dir("Reading"), file("note.md")])).toEqual(["Inbox"]);
    expect(defaultHomeFolders([dir("Reading"), file("Inbox")])).toEqual([]);
  });

  it("offers Home only to root-level folders", () => {
    expect(isHomeCandidate(dir("Reading"))).toBe(true);
    expect(isHomeCandidate({ is_directory: true, path: "Reading/2024" })).toBe(false);
    expect(isHomeCandidate(file("note.md"))).toBe(false);
  });

  it("adds and removes, idempotently, and compacts folders that vanished — never present ones", () => {
    const root = [dir("Inbox"), dir("Reading"), dir("Writing"), file("Archive")];
    expect(applyHomeChange(["Inbox"], "Reading", true, root)).toEqual(["Inbox", "Reading"]);
    expect(applyHomeChange(["Inbox", "Reading"], "Reading", true, root)).toEqual(["Inbox", "Reading"]);
    expect(applyHomeChange(["Inbox", "Reading"], "Inbox", false, root)).toEqual(["Reading"]);
    // "Gone" was renamed on the Mac; "Archive" is now a file. Both drop on this write.
    expect(applyHomeChange(["Inbox", "Gone", "Archive"], "Writing", true, root)).toEqual(["Inbox", "Writing"]);
    expect(applyHomeChange(["Reading"], "Reading", false, root)).toEqual([]);
  });

  it("keys Home's screen memory where no folder path can reach", () => {
    expect(HOME_KEY.startsWith("/")).toBe(true);
  });
});
