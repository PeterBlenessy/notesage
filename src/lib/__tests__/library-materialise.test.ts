import { describe, it, expect, vi } from "vitest";
import { materialiseLibrary, type MaterialiseDeps } from "@/lib/library-materialise";
import type { ICloudDownloadState } from "@/lib/tauri";

/**
 * The materialise-first pre-flight.
 *
 * This is the half of the migration that closes the only path to true data
 * loss the review found — an eviction between the guard and the rename — so
 * the cases below are about what it must NOT do: report clean when a root
 * could not be read, stop waiting because iCloud said "failed" once, or
 * serialise a library's worth of downloads one at a time.
 */

function deps(over: Partial<MaterialiseDeps> = {}): MaterialiseDeps {
  return {
    listPlaceholders: async () => [],
    ensureDownloaded: async () => "downloading" as ICloudDownloadState,
    exists: async () => true,
    wait: async () => {},
    maxSweeps: 3,
    ...over,
  };
}

describe("materialising a library before it moves", () => {
  it("has nothing to do when nothing is evicted", async () => {
    const report = await materialiseLibrary(["/old", "/new"], deps());

    expect(report).toEqual({ requested: 0, arrived: 0, pending: [], cancelled: false });
  });

  it("walks BOTH roots, because either can hold a stub", async () => {
    // The destination matters as much as the source: a placeholder there is a
    // name already taken, and reading the listing literally misses the
    // collision — in exactly the case this feature is for, a Mac joining a
    // library whose contents have not all come down.
    const report = await materialiseLibrary(["/old", "/new"], deps({
      listPlaceholders: async (root) => [`${root}/note.md`],
    }));

    expect(report.requested).toBe(2);
    expect(report.arrived).toBe(2);
  });

  it("asks for every file BEFORE waiting for any of them", async () => {
    // iCloud fetches in parallel. Asking for one, waiting for it, then asking
    // for the next would serialise a whole library over the network — on the
    // kind of link where this matters most.
    const order: string[] = [];
    let seen = 0;
    await materialiseLibrary(["/old"], deps({
      listPlaceholders: async () => ["/old/a.md", "/old/b.md", "/old/c.md"],
      ensureDownloaded: async (path) => {
        order.push(`ask ${path}`);
        return "downloading";
      },
      exists: async (path) => {
        order.push(`check ${path}`);
        seen += 1;
        return true;
      },
    }));

    expect(seen).toBe(3);
    expect(order.slice(0, 3)).toEqual(["ask /old/a.md", "ask /old/b.md", "ask /old/c.md"]);
  });

  it("waits for a file that arrives on a later sweep", async () => {
    let sweeps = 0;
    const progress: [number, number][] = [];
    const report = await materialiseLibrary(["/old"], deps({
      listPlaceholders: async () => ["/old/slow.md", "/old/fast.md"],
      exists: async (path) => {
        if (path === "/old/fast.md") return true;
        sweeps += 1;
        return sweeps > 2;
      },
      onProgress: (arrived, total) => progress.push([arrived, total]),
      maxSweeps: 10,
    }));

    expect(report.pending).toEqual([]);
    expect(report.arrived).toBe(2);
    // Something moved on the way, or the modal is a spinner with no news.
    expect(progress[0]).toEqual([1, 2]);
    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });

  it("keeps waiting for a file iCloud reported as failed", async () => {
    // A refused request is not proof the file will not arrive — another
    // device, or a retry, may still bring it. The only thing that settles it
    // is whether the file is there.
    let asked = 0;
    const report = await materialiseLibrary(["/old"], deps({
      listPlaceholders: async () => ["/old/gone.md"],
      ensureDownloaded: async () => "failed",
      exists: async () => {
        asked += 1;
        return asked > 1;
      },
      maxSweeps: 10,
    }));

    expect(report.pending).toEqual([]);
    expect(report.arrived).toBe(1);
  });

  it("names what never arrived, with what iCloud last said", async () => {
    const report = await materialiseLibrary(["/old"], deps({
      listPlaceholders: async () => ["/old/stuck.md"],
      ensureDownloaded: async () => "failed",
      exists: async () => false,
    }));

    expect(report.arrived).toBe(0);
    expect(report.pending).toEqual([{ path: "/old/stuck.md", reason: "failed" }]);
    expect(report.cancelled).toBe(false);
  });

  it("records the error when the request itself throws, and still waits", async () => {
    const report = await materialiseLibrary(["/old"], deps({
      listPlaceholders: async () => ["/old/x.md"],
      ensureDownloaded: async () => {
        throw new Error("iCloud is unavailable");
      },
      exists: async () => false,
    }));

    expect(report.pending[0].reason).toContain("iCloud is unavailable");
  });

  it("lets a root that cannot be read throw, rather than reporting it clean", async () => {
    // The failure this whole feature keeps re-learning: a swallowed listing
    // reads as "nothing to download", which is a clean bill of health handed
    // to exactly the case the pre-flight exists to catch.
    await expect(
      materialiseLibrary(["/old"], deps({
        listPlaceholders: async () => {
          throw new Error("Could not read /old to check for undownloaded files");
        },
      })),
    ).rejects.toThrow("Could not read");
  });

  it("stops when cancelled, and says the pending list is not a verdict", async () => {
    // A modal spinner with no way out is its own failure. What stops is the
    // WAITING — the downloads iCloud has been asked for carry on in its time.
    let sweeps = 0;
    const report = await materialiseLibrary(["/old"], deps({
      listPlaceholders: async () => ["/old/big.md"],
      exists: async () => false,
      isCancelled: () => sweeps++ > 0,
      maxSweeps: 100,
    }));

    expect(report.cancelled).toBe(true);
    expect(report.pending).toHaveLength(1);
  });

  it("cancels before asking, when the answer came that fast", async () => {
    const ensureDownloaded = vi.fn(async () => "downloading" as ICloudDownloadState);
    const report = await materialiseLibrary(["/old"], deps({
      listPlaceholders: async () => ["/old/a.md"],
      ensureDownloaded,
      isCancelled: () => true,
    }));

    expect(ensureDownloaded).not.toHaveBeenCalled();
    expect(report.cancelled).toBe(true);
  });

  it("asks for the same file once when both roots name it", async () => {
    const asked: string[] = [];
    await materialiseLibrary(["/root", "/root"], deps({
      listPlaceholders: async () => ["/root/dup.md"],
      ensureDownloaded: async (path) => {
        asked.push(path);
        return "downloading";
      },
    }));

    expect(asked).toEqual(["/root/dup.md"]);
  });
});
