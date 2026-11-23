import { describe, it, expect } from "vitest";
import { classifyMissingMarker, markerPlaceholderPath } from "@/lib/library-marker-state";

const ROOT = "/Users/w/Library/Mobile Documents/iCloud~com~notesage~app/Documents";
const FILE = `${ROOT}/.notesage/library.json`;
const PLACEHOLDER = `${ROOT}/.notesage/.library.json.icloud`;

function deps(existing: string[], readable = true) {
  return {
    pathExists: async (p: string) => existing.includes(p),
    readFile: async (p: string) => {
      if (!readable || !existing.includes(p)) throw new Error("EPERM");
      return "not a marker";
    },
  };
}

describe("why a library marker read came back empty", () => {
  it("names the iCloud placeholder path", () => {
    expect(markerPlaceholderPath(ROOT)).toBe(PLACEHOLDER);
  });

  it("is absent only when neither the file nor its placeholder is there", async () => {
    expect(await classifyMissingMarker(ROOT, deps([]))).toBe("absent");
  });

  it("is pending while iCloud holds it as a placeholder", async () => {
    // The case that removed a second Mac's projects: `None` from the reader
    // was taken to mean "this library was never migrated".
    expect(await classifyMissingMarker(ROOT, deps([PLACEHOLDER]))).toBe("pending");
  });

  it("is unreadable when the file exists and cannot be read", async () => {
    expect(await classifyMissingMarker(ROOT, deps([FILE], false))).toBe("unreadable");
  });

  it("treats a readable file that is not a marker as absent (junk rule)", async () => {
    expect(await classifyMissingMarker(ROOT, deps([FILE]))).toBe("absent");
  });

  it("does not call a failed existence check 'absent'", async () => {
    const failing = {
      pathExists: async () => {
        throw new Error("EIO");
      },
      readFile: async () => "",
    };
    expect(await classifyMissingMarker(ROOT, failing)).toBe("unreadable");
  });
});
