// @vitest-environment jsdom
/**
 * The Inbox folder's name must never be translated.
 *
 * `Inbox/` is a real directory at the library root — the Rust capture crate
 * writes there, the desktop reads it there, and Files and iCloud Drive show it
 * under that name. Translating the label makes the app say a name that exists
 * nowhere: a Swedish phone showed "Inkorg" beside a folder called `Inbox`.
 *
 * This is a regression test rather than a unit test, because the bug is
 * invisible in the language most people develop in — on an English device
 * every surface agreed, which is how it shipped (Peter, 2026-08-17).
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { InboxCard } from "@/components/mobile/InboxCard";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";
import { setLocale } from "@/lib/i18n";

afterEach(() => setLocale(null));

describe("Inbox is never translated", () => {
  it("renders the folder's real name in Swedish", () => {
    setLocale("sv");
    render(<InboxCard count={3} onOpen={() => {}} />);
    expect(screen.getByText(INBOX_FOLDER_NAME)).toBeTruthy();
    expect(screen.queryByText("Inkorg")).toBeNull();
  });

  it("renders the same name in English", () => {
    setLocale("en");
    render(<InboxCard count={3} onOpen={() => {}} />);
    expect(screen.getByText(INBOX_FOLDER_NAME)).toBeTruthy();
  });

  it("matches the folder the capture crate writes to", () => {
    // The contract this whole rule rests on. If the Rust side ever changes the
    // directory, this fails rather than the app quietly pointing at a folder
    // that no longer receives anything.
    //
    // Read the CONSTANT's value, not merely the presence of the string. An
    // earlier version asserted `toContain('"Inbox')`, which passed on any of
    // the five unrelated `"Inbox/..."` literals in that file's own tests — so
    // renaming INBOX_DIR to "Drafts" left it green, which is precisely the
    // drift it exists to catch.
    const capture = readFileSync("src-tauri/crates/notesage-capture/src/lib.rs", "utf8");
    const declared = capture.match(/pub const INBOX_DIR: &str = "([^"]+)"/);
    expect(declared?.[1]).toBe(INBOX_FOLDER_NAME);
  });

  it("has no translation key for it", () => {
    // A key would invite someone to translate it again. The absence is the
    // safeguard, so assert the absence.
    const i18n = readFileSync("src/lib/i18n.ts", "utf8");
    expect(i18n).not.toContain("library.inbox");
  });
});
