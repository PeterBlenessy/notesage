/**
 * Unit tests for the shared pins.json format + path helpers (#652).
 * Pure logic — no Tauri IPC involved.
 */
import { describe, it, expect } from "vitest";
import {
  PINS_FILE_REL_PATH,
  pinsFilePath,
  isInsideLibraryRoot,
  toRelativePinPath,
  toAbsolutePinPath,
  parsePinsFileContent,
  serializePinsFileContent,
  derivePinsFilePaths,
  mergePinsFromFile,
  groupByPinned,
} from "../pins-file";

const LIBRARY_ROOT = "/Users/x/Library/Mobile Documents/com~apple~CloudDocs/Notesage";

describe("pinsFilePath", () => {
  it("appends the shared relative path to the library root", () => {
    expect(pinsFilePath(LIBRARY_ROOT)).toBe(`${LIBRARY_ROOT}/${PINS_FILE_REL_PATH}`);
  });
});

describe("isInsideLibraryRoot", () => {
  it("is true for a descendant path", () => {
    expect(isInsideLibraryRoot(`${LIBRARY_ROOT}/notes/a.md`, LIBRARY_ROOT)).toBe(true);
  });

  it("is true for the root itself", () => {
    expect(isInsideLibraryRoot(LIBRARY_ROOT, LIBRARY_ROOT)).toBe(true);
  });

  it("is false for a sibling path with a similar-looking prefix", () => {
    expect(isInsideLibraryRoot(`${LIBRARY_ROOT}-other/a.md`, LIBRARY_ROOT)).toBe(false);
  });

  it("is false for an unrelated path", () => {
    expect(isInsideLibraryRoot("/Users/x/elsewhere/a.md", LIBRARY_ROOT)).toBe(false);
  });
});

describe("toRelativePinPath / toAbsolutePinPath", () => {
  it("converts an absolute path inside the root to a relative one", () => {
    expect(toRelativePinPath(`${LIBRARY_ROOT}/notes/a.md`, LIBRARY_ROOT)).toBe("notes/a.md");
  });

  it("returns null for a path outside the root", () => {
    expect(toRelativePinPath("/Users/x/elsewhere/a.md", LIBRARY_ROOT)).toBeNull();
  });

  it("round-trips relative → absolute", () => {
    const abs = toAbsolutePinPath("notes/a.md", LIBRARY_ROOT);
    expect(abs).toBe(`${LIBRARY_ROOT}/notes/a.md`);
    expect(toRelativePinPath(abs, LIBRARY_ROOT)).toBe("notes/a.md");
  });
});

describe("parsePinsFileContent", () => {
  it("parses a well-formed pins.json", () => {
    expect(parsePinsFileContent('{"paths":["a.md","Sub/b.md"]}')).toEqual(["a.md", "Sub/b.md"]);
  });

  it("returns an empty array for malformed JSON instead of throwing", () => {
    expect(parsePinsFileContent("not json")).toEqual([]);
  });

  it("returns an empty array when paths is missing or the wrong shape", () => {
    expect(parsePinsFileContent("{}")).toEqual([]);
    expect(parsePinsFileContent('{"paths":"not-an-array"}')).toEqual([]);
  });

  it("filters out non-string entries", () => {
    expect(parsePinsFileContent('{"paths":["a.md", 42, null]}')).toEqual(["a.md"]);
  });
});

describe("serializePinsFileContent", () => {
  it("round-trips through parsePinsFileContent", () => {
    const paths = ["a.md", "Sub/b.md"];
    expect(parsePinsFileContent(serializePinsFileContent(paths))).toEqual(paths);
  });

  it("serializes an empty array as an empty paths list (not omitted)", () => {
    expect(JSON.parse(serializePinsFileContent([]))).toEqual({ paths: [] });
  });
});

describe("derivePinsFilePaths", () => {
  it("keeps only paths inside the library root, converted to relative form", () => {
    const result = derivePinsFilePaths(
      [`${LIBRARY_ROOT}/notes/a.md`, "/Users/x/elsewhere/b.md", `${LIBRARY_ROOT}/c.md`],
      LIBRARY_ROOT,
    );
    expect(result).toEqual(["notes/a.md", "c.md"]);
  });

  it("dedupes relative paths", () => {
    const result = derivePinsFilePaths(
      [`${LIBRARY_ROOT}/a.md`, `${LIBRARY_ROOT}/a.md`],
      LIBRARY_ROOT,
    );
    expect(result).toEqual(["a.md"]);
  });

  it("returns an empty array when nothing is inside the root", () => {
    expect(derivePinsFilePaths(["/Users/x/elsewhere/a.md"], LIBRARY_ROOT)).toEqual([]);
  });
});

describe("mergePinsFromFile", () => {
  it("adds remote-only entries as absolute paths without dropping local ones", () => {
    const merged = mergePinsFromFile(
      [`${LIBRARY_ROOT}/local-only.md`],
      ["remote-only.md", "local-only.md"],
      LIBRARY_ROOT,
    );
    expect(merged).toContain(`${LIBRARY_ROOT}/local-only.md`);
    expect(merged).toContain(`${LIBRARY_ROOT}/remote-only.md`);
    // No duplicate for the entry both sides already agree on.
    expect(merged.filter((p) => p === `${LIBRARY_ROOT}/local-only.md`)).toHaveLength(1);
  });

  it("is a no-op when the remote list is empty", () => {
    const pinned = [`${LIBRARY_ROOT}/a.md`];
    expect(mergePinsFromFile(pinned, [], LIBRARY_ROOT)).toEqual(pinned);
  });
});

describe("groupByPinned", () => {
  interface Entry {
    path: string;
  }
  const entries: Entry[] = [{ path: "alpha.md" }, { path: "beta.md" }, { path: "gamma.md" }];

  it("buckets pinned entries separately, preserving relative order in each bucket", () => {
    const { pinned, rest } = groupByPinned(entries, ["beta.md"], (e) => e.path);
    expect(pinned.map((e) => e.path)).toEqual(["beta.md"]);
    expect(rest.map((e) => e.path)).toEqual(["alpha.md", "gamma.md"]);
  });

  it("returns everything in rest when there are no pinned paths", () => {
    const { pinned, rest } = groupByPinned(entries, [], (e) => e.path);
    expect(pinned).toEqual([]);
    expect(rest).toEqual(entries);
  });
});
