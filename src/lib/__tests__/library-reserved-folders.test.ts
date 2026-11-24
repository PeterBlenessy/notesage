import { describe, it, expect } from "vitest";
import { isReservedLibraryFolder } from "../library-reserved-folders";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";
import { RECORDINGS_FOLDER_NAME } from "@/lib/notes-root";

const ROOT = "/Users/me/Library/Mobile Documents/iCloud~com~notesage/Documents";

describe("isReservedLibraryFolder", () => {
  it("matches the Inbox and Recordings folders directly under the library root", () => {
    expect(isReservedLibraryFolder(`${ROOT}/${INBOX_FOLDER_NAME}`, ROOT)).toBe(true);
    expect(isReservedLibraryFolder(`${ROOT}/${RECORDINGS_FOLDER_NAME}`, ROOT)).toBe(true);
  });

  it("ignores trailing slashes on either argument", () => {
    expect(isReservedLibraryFolder(`${ROOT}/Inbox/`, ROOT)).toBe(true);
    expect(isReservedLibraryFolder(`${ROOT}/Recordings`, `${ROOT}/`)).toBe(true);
  });

  it("does not match ordinary projects", () => {
    expect(isReservedLibraryFolder(`${ROOT}/Work`, ROOT)).toBe(false);
    expect(isReservedLibraryFolder(`${ROOT}/Inbox2`, ROOT)).toBe(false);
    expect(isReservedLibraryFolder(`${ROOT}/inbox`, ROOT)).toBe(false);
  });

  it("does not match a nested folder of the same name, or the root itself", () => {
    expect(isReservedLibraryFolder(`${ROOT}/Work/Inbox`, ROOT)).toBe(false);
    expect(isReservedLibraryFolder(`${ROOT}/Inbox/Recordings`, ROOT)).toBe(false);
    expect(isReservedLibraryFolder(ROOT, ROOT)).toBe(false);
  });

  it("does not match an Inbox under a different root", () => {
    expect(isReservedLibraryFolder("/Users/me/Notesage/Inbox", ROOT)).toBe(false);
  });

  it("matches nothing when the library root is empty", () => {
    expect(isReservedLibraryFolder("/Inbox", "")).toBe(false);
  });
});
