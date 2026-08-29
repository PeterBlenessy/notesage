// @vitest-environment jsdom
/**
 * Repairing a saved article's missing doctype when it is opened (#805).
 *
 * Articles saved before the `Document::fragment` fix are still in quirks mode
 * on disk, and the image sweep will not revisit them — it returns early once
 * no remote image is left. The reader repairs them instead.
 *
 * What is worth pinning here is not "it calls the command" but the four
 * properties the call site depends on, each of which is invisible from reading
 * the happy path and each of which is actively harmful to get wrong:
 *
 *   1. A healthy article is NOT written. Otherwise every open of every report
 *      churns its modification date and re-syncs it through iCloud for nothing.
 *   2. The file IS written when damaged — a saved article is meant to open in
 *      Safari or Quick Look too, so patching only our renderer is not a fix.
 *   3. Rendering does not WAIT for that write. It is a coordinated iCloud
 *      write, and awaiting it would put its latency in front of every report.
 *   4. A failed write still renders the repaired document, and leaves the file
 *      to be retried on the next open.
 *
 * The repair DECISION itself is Rust's (`notesage-capture::repair_missing_doctype`,
 * unit-tested there); this file covers only the orchestration around it.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const repairMock = vi.fn<(content: string) => Promise<string | null>>();
const writeMock = vi.fn<(relPath: string, content: string) => Promise<void>>();

vi.mock("@/lib/ios-api", () => ({
  iosRepairHtmlDoctype: (content: string) => repairMock(content),
  iosWriteFile: (relPath: string, content: string) => writeMock(relPath, content),
  // The reader imports a good deal more than this helper needs; the module
  // factory has to satisfy every named import in Reader.tsx or the import
  // throws before a single assertion runs.
  iosReadFile: vi.fn(),
  iosReadBinary: vi.fn(),
  iosEnsureDownloaded: vi.fn(),
  iosShareFile: vi.fn(),
  iosRenameFile: vi.fn(),
  iosCreateFile: vi.fn(),
  iosStatFile: vi.fn(),
  iosContextMenu: vi.fn(),
  iosPresentReport: vi.fn(),
  iosDismissReport: vi.fn(),
  iosFindInReport: vi.fn(),
}));

import { repairDoctypeOnOpen } from "../Reader";

const DAMAGED = "<html><meta charset=\"utf-8\"><p>Body</p></html>";
const REPAIRED = `<!doctype html>\n${DAMAGED}`;

beforeEach(() => {
  repairMock.mockReset();
  writeMock.mockReset();
  writeMock.mockResolvedValue(undefined);
});

describe("repairDoctypeOnOpen", () => {
  it("does not write a document that needs no repair", async () => {
    repairMock.mockResolvedValue(null);

    const healthy = "<!doctype html>\n<html><p>Fine</p></html>";
    await expect(repairDoctypeOnOpen("Inbox/a.html", healthy)).resolves.toBe(healthy);

    expect(writeMock).not.toHaveBeenCalled();
  });

  it("writes the repaired document back to the file", async () => {
    repairMock.mockResolvedValue(REPAIRED);

    await expect(repairDoctypeOnOpen("Inbox/a.html", DAMAGED)).resolves.toBe(REPAIRED);

    expect(writeMock).toHaveBeenCalledWith("Inbox/a.html", REPAIRED);
  });

  it("renders without waiting for the write to finish", async () => {
    repairMock.mockResolvedValue(REPAIRED);
    // A write that never settles — awaiting it would hang this test, which is
    // exactly the hang a user would feel when opening a report.
    let settled = false;
    writeMock.mockImplementation(
      () =>
        new Promise<void>(() => {
          settled = true;
        }),
    );

    await expect(repairDoctypeOnOpen("Inbox/a.html", DAMAGED)).resolves.toBe(REPAIRED);
    expect(settled).toBe(true); // the write did start
  });

  it("still renders the repaired document when the write fails", async () => {
    repairMock.mockResolvedValue(REPAIRED);
    writeMock.mockRejectedValue(new Error("read-only volume"));

    await expect(repairDoctypeOnOpen("Inbox/a.html", DAMAGED)).resolves.toBe(REPAIRED);
  });

  it("renders the original when the repair command itself fails", async () => {
    // A build without the native command, or an IPC failure. The reader must
    // show the article regardless — a missing doctype is a formatting problem,
    // not a reason to fail the open.
    repairMock.mockRejectedValue(new Error("no such command"));

    await expect(repairDoctypeOnOpen("Inbox/a.html", DAMAGED)).resolves.toBe(DAMAGED);
    expect(writeMock).not.toHaveBeenCalled();
  });
});
