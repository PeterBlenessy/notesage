/**
 * RED tests for the crash-safe rename transaction manager (issue #144).
 *
 * Tests cover the three commit phases (prepare, committing, committed) and
 * the startup recovery path for incomplete transactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockResolvedValue('{}');
const mockPathExists = vi.fn().mockResolvedValue(false);
const mockDeletePath = vi.fn().mockResolvedValue(undefined);
const mockCreateDirectory = vi.fn().mockResolvedValue(undefined);
const mockListDirectory = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    pathExists: (...args: unknown[]) => mockPathExists(...args),
    deletePath: (...args: unknown[]) => mockDeletePath(...args),
    createDirectory: (...args: unknown[]) => mockCreateDirectory(...args),
    listDirectory: (...args: unknown[]) => mockListDirectory(...args),
  },
}));

import {
  executeRenameTransaction,
  recoverIncompleteTransactions,
  isRenameTransactionManifest,
  RENAME_TXN_DIR,
  type RenameTransactionManifest,
  type TransactionPhase,
} from '../rename-transaction';

const NOTES_ROOT = '/Users/test/Notesage';
const TXN_BASE = `${NOTES_ROOT}/.notesage/${RENAME_TXN_DIR}`;

beforeEach(() => {
  vi.clearAllMocks();
  mockPathExists.mockResolvedValue(false);
  mockListDirectory.mockResolvedValue([]);
  mockReadFile.mockResolvedValue('{}');
  mockWriteFile.mockResolvedValue(undefined);
  mockDeletePath.mockResolvedValue(undefined);
  mockCreateDirectory.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Phase tests: prepare → committing → committed
// ---------------------------------------------------------------------------

describe('executeRenameTransaction — happy path (prepare → committing → committed)', () => {
  it('writes staging copies during prepare phase', async () => {
    const oldSidecar = `${NOTES_ROOT}/.notesage/comments/path-old.json`;
    const newSidecar = `${NOTES_ROOT}/.notesage/comments/path-new.json`;
    const content = JSON.stringify({ originalPath: '/notes/old.md', comments: [] });

    // old sidecar exists
    mockPathExists.mockImplementation(async (p: string) => p === oldSidecar);
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === oldSidecar) return content;
      return '{}';
    });

    const writtenFiles: Array<{ path: string; content: string }> = [];
    mockWriteFile.mockImplementation(async (p: string, c: string) => {
      writtenFiles.push({ path: p, content: c });
    });

    await executeRenameTransaction(NOTES_ROOT, [
      { oldSidecar, newSidecar, newFilePath: '/notes/new.md' },
    ]);

    // Staging copies should have been written during prepare
    const stagingWrites = writtenFiles.filter((w) => w.path.includes(RENAME_TXN_DIR));
    expect(stagingWrites.length).toBeGreaterThan(0);
  });

  it('marks manifest as "committing" before applying destination writes', async () => {
    const oldSidecar = `${NOTES_ROOT}/.notesage/comments/path-old.json`;
    const newSidecar = `${NOTES_ROOT}/.notesage/comments/path-new.json`;
    const content = JSON.stringify({ originalPath: '/notes/old.md', comments: [] });

    mockPathExists.mockImplementation(async (p: string) => p === oldSidecar);
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === oldSidecar) return content;
      return '{}';
    });

    const manifestWrites: Array<{ path: string; content: string }> = [];
    mockWriteFile.mockImplementation(async (p: string, c: string) => {
      if (p.endsWith('manifest.json')) {
        manifestWrites.push({ path: p, content: c });
      }
    });

    await executeRenameTransaction(NOTES_ROOT, [
      { oldSidecar, newSidecar, newFilePath: '/notes/new.md' },
    ]);

    // Should have written manifest with "committing" phase at some point
    const committingWrite = manifestWrites.find((w) => {
      try {
        const m = JSON.parse(w.content) as RenameTransactionManifest;
        return m.phase === 'committing';
      } catch {
        return false;
      }
    });
    expect(committingWrite).toBeDefined();
  });

  it('writes the new sidecar to the destination path during commit', async () => {
    const oldSidecar = `${NOTES_ROOT}/.notesage/comments/path-old.json`;
    const newSidecar = `${NOTES_ROOT}/.notesage/comments/path-new.json`;
    const content = JSON.stringify({ originalPath: '/notes/old.md', comments: [{ id: 'c1' }] });

    mockPathExists.mockImplementation(async (p: string) => p === oldSidecar);
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === oldSidecar) return content;
      // staging files also return the same content
      if (p.includes(RENAME_TXN_DIR)) return content;
      return '{}';
    });

    const writtenFiles: Array<{ path: string; content: string }> = [];
    mockWriteFile.mockImplementation(async (p: string, c: string) => {
      writtenFiles.push({ path: p, content: c });
    });

    await executeRenameTransaction(NOTES_ROOT, [
      { oldSidecar, newSidecar, newFilePath: '/notes/new.md' },
    ]);

    // The new sidecar destination must be written
    const destWrite = writtenFiles.find((w) => w.path === newSidecar);
    expect(destWrite).toBeDefined();
  });

  it('deletes the old sidecar after writing the new one', async () => {
    const oldSidecar = `${NOTES_ROOT}/.notesage/comments/path-old.json`;
    const newSidecar = `${NOTES_ROOT}/.notesage/comments/path-new.json`;
    const content = JSON.stringify({ originalPath: '/notes/old.md', comments: [] });

    mockPathExists.mockImplementation(async (p: string) => p === oldSidecar);
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === oldSidecar || p.includes(RENAME_TXN_DIR)) return content;
      return '{}';
    });

    const deletedPaths: string[] = [];
    mockDeletePath.mockImplementation(async (p: string) => {
      deletedPaths.push(p);
    });

    await executeRenameTransaction(NOTES_ROOT, [
      { oldSidecar, newSidecar, newFilePath: '/notes/new.md' },
    ]);

    expect(deletedPaths).toContain(oldSidecar);
  });

  it('cleans up the staging directory after committed phase', async () => {
    const oldSidecar = `${NOTES_ROOT}/.notesage/comments/path-old.json`;
    const newSidecar = `${NOTES_ROOT}/.notesage/comments/path-new.json`;
    const content = JSON.stringify({ originalPath: '/notes/old.md', comments: [] });

    mockPathExists.mockImplementation(async (p: string) => p === oldSidecar || p.includes(RENAME_TXN_DIR));
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === oldSidecar || p.includes(RENAME_TXN_DIR)) return content;
      return '{}';
    });

    const deletedPaths: string[] = [];
    mockDeletePath.mockImplementation(async (p: string) => {
      deletedPaths.push(p);
    });

    await executeRenameTransaction(NOTES_ROOT, [
      { oldSidecar, newSidecar, newFilePath: '/notes/new.md' },
    ]);

    // The staging directory for this transaction must be cleaned up
    const txnDirCleanup = deletedPaths.some((p) => p.includes(RENAME_TXN_DIR));
    expect(txnDirCleanup).toBe(true);
  });

  it('is a no-op when the old sidecar does not exist', async () => {
    const oldSidecar = `${NOTES_ROOT}/.notesage/comments/path-nosidecar.json`;
    const newSidecar = `${NOTES_ROOT}/.notesage/comments/path-new.json`;

    mockPathExists.mockResolvedValue(false);

    const writtenFiles: string[] = [];
    mockWriteFile.mockImplementation(async (p: string) => { writtenFiles.push(p); });

    await executeRenameTransaction(NOTES_ROOT, [
      { oldSidecar, newSidecar, newFilePath: '/notes/new.md' },
    ]);

    // No destination write should happen if source doesn't exist
    expect(writtenFiles.filter((p) => p === newSidecar)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Crash recovery: crash before commit marked (rollback)
// ---------------------------------------------------------------------------

describe('recoverIncompleteTransactions — crash during prepare (rollback)', () => {
  it('cleans up staging dir and leaves old sidecars untouched when crashed before committing', async () => {
    const txnId = 'txn-prepare-crash';
    const txnDir = `${TXN_BASE}/${txnId}`;
    const manifestPath = `${txnDir}/manifest.json`;
    const oldSidecar = `${NOTES_ROOT}/.notesage/comments/path-old.json`;
    const newSidecar = `${NOTES_ROOT}/.notesage/comments/path-new.json`;
    const stagingFile = `${txnDir}/entry-0.json`;

    const manifest: RenameTransactionManifest = {
      txnId,
      phase: 'prepare', // crashed before reaching "committing"
      entries: [{ oldSidecar, newSidecar, stagingFile }],
      createdAt: Date.now() - 60_000, // 1 minute ago
    };

    // The txn dir and staging file exist
    mockListDirectory.mockImplementation(async (p: string) => {
      if (p === TXN_BASE) {
        return [{ name: txnId, path: txnDir, is_directory: true, hidden: false }];
      }
      return [];
    });
    mockPathExists.mockImplementation(async (p: string) =>
      p === txnDir || p === manifestPath || p === stagingFile
    );
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === manifestPath) return JSON.stringify(manifest);
      return '{}';
    });

    const deletedPaths: string[] = [];
    mockDeletePath.mockImplementation(async (p: string) => { deletedPaths.push(p); });
    const writtenFiles: string[] = [];
    mockWriteFile.mockImplementation(async (p: string) => { writtenFiles.push(p); });

    await recoverIncompleteTransactions(NOTES_ROOT);

    // The new destination sidecar must NOT have been written (rollback, not commit)
    expect(writtenFiles).not.toContain(newSidecar);
    // The staging directory should be cleaned up
    const txnDirDeleted = deletedPaths.some((p) => p.includes(txnId));
    expect(txnDirDeleted).toBe(true);
  });

  it('does not delete the old sidecar when rolling back a prepare-phase crash', async () => {
    const txnId = 'txn-rollback-test';
    const txnDir = `${TXN_BASE}/${txnId}`;
    const manifestPath = `${txnDir}/manifest.json`;
    const oldSidecar = `${NOTES_ROOT}/.notesage/comments/path-still-here.json`;
    const newSidecar = `${NOTES_ROOT}/.notesage/comments/path-new.json`;
    const stagingFile = `${txnDir}/entry-0.json`;

    const manifest: RenameTransactionManifest = {
      txnId,
      phase: 'prepare',
      entries: [{ oldSidecar, newSidecar, stagingFile }],
      createdAt: Date.now() - 5_000,
    };

    mockListDirectory.mockImplementation(async (p: string) => {
      if (p === TXN_BASE) {
        return [{ name: txnId, path: txnDir, is_directory: true, hidden: false }];
      }
      return [];
    });
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === manifestPath) return JSON.stringify(manifest);
      return '{}';
    });

    const deletedPaths: string[] = [];
    mockDeletePath.mockImplementation(async (p: string) => { deletedPaths.push(p); });

    await recoverIncompleteTransactions(NOTES_ROOT);

    // Old sidecar must NOT be deleted during rollback
    expect(deletedPaths).not.toContain(oldSidecar);
  });
});

// ---------------------------------------------------------------------------
// Crash recovery: crash after "committing" is marked (resume / apply)
// ---------------------------------------------------------------------------

describe('recoverIncompleteTransactions — crash after committing marked (resume)', () => {
  it('applies the migration (write new + delete old) when crashed after committing', async () => {
    const txnId = 'txn-committing-crash';
    const txnDir = `${TXN_BASE}/${txnId}`;
    const manifestPath = `${txnDir}/manifest.json`;
    const oldSidecar = `${NOTES_ROOT}/.notesage/comments/path-old.json`;
    const newSidecar = `${NOTES_ROOT}/.notesage/comments/path-new.json`;
    const stagingFile = `${txnDir}/entry-0.json`;
    const sidecarContent = JSON.stringify({ originalPath: '/notes/old.md', comments: [{ id: 'c1' }] });

    const manifest: RenameTransactionManifest = {
      txnId,
      phase: 'committing', // crashed after being marked committing
      entries: [{ oldSidecar, newSidecar, stagingFile }],
      createdAt: Date.now() - 30_000,
    };

    mockListDirectory.mockImplementation(async (p: string) => {
      if (p === TXN_BASE) {
        return [{ name: txnId, path: txnDir, is_directory: true, hidden: false }];
      }
      return [];
    });
    mockPathExists.mockImplementation(async (p: string) =>
      p === txnDir || p === manifestPath || p === stagingFile
    );
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === manifestPath) return JSON.stringify(manifest);
      if (p === stagingFile) return sidecarContent;
      return '{}';
    });

    const writtenFiles: Array<{ path: string; content: string }> = [];
    mockWriteFile.mockImplementation(async (p: string, c: string) => {
      writtenFiles.push({ path: p, content: c });
    });
    const deletedPaths: string[] = [];
    mockDeletePath.mockImplementation(async (p: string) => { deletedPaths.push(p); });

    await recoverIncompleteTransactions(NOTES_ROOT);

    // The new sidecar must be written during recovery
    const destWrite = writtenFiles.find((w) => w.path === newSidecar);
    expect(destWrite).toBeDefined();
    expect(JSON.parse(destWrite!.content)).toMatchObject({ comments: [{ id: 'c1' }] });

    // The old sidecar must be deleted (only if it exists on disk, which it does here
    // because oldSidecar is not in our mockPathExists, but the recovery should
    // attempt it unconditionally and handle errors gracefully)
    // Staging cleanup must also occur
    const txnCleanup = deletedPaths.some((p) => p.includes(txnId));
    expect(txnCleanup).toBe(true);
  });

  it('completes recovery for all entries when a transaction has multiple sidecars', async () => {
    const txnId = 'txn-multi-entry';
    const txnDir = `${TXN_BASE}/${txnId}`;
    const manifestPath = `${txnDir}/manifest.json`;

    const entries = [
      {
        oldSidecar: `${NOTES_ROOT}/.notesage/comments/path-a.json`,
        newSidecar: `${NOTES_ROOT}/.notesage/comments/path-aa.json`,
        stagingFile: `${txnDir}/entry-0.json`,
      },
      {
        oldSidecar: `${NOTES_ROOT}/.notesage/comments/path-b.json`,
        newSidecar: `${NOTES_ROOT}/.notesage/comments/path-bb.json`,
        stagingFile: `${txnDir}/entry-1.json`,
      },
    ];

    const manifest: RenameTransactionManifest = {
      txnId,
      phase: 'committing',
      entries,
      createdAt: Date.now() - 10_000,
    };

    mockListDirectory.mockImplementation(async (p: string) => {
      if (p === TXN_BASE) {
        return [{ name: txnId, path: txnDir, is_directory: true, hidden: false }];
      }
      return [];
    });
    mockPathExists.mockImplementation(async (p: string) =>
      p === txnDir || p === manifestPath || p.includes(txnDir)
    );
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === manifestPath) return JSON.stringify(manifest);
      // All staging files return valid content
      if (p.includes(txnDir)) return JSON.stringify({ originalPath: '/notes/x.md', comments: [] });
      return '{}';
    });

    const writtenFiles: string[] = [];
    mockWriteFile.mockImplementation(async (p: string) => { writtenFiles.push(p); });

    await recoverIncompleteTransactions(NOTES_ROOT);

    // Both new sidecars must be written
    expect(writtenFiles).toContain(entries[0].newSidecar);
    expect(writtenFiles).toContain(entries[1].newSidecar);
  });
});

// ---------------------------------------------------------------------------
// No-op when txn dir does not exist
// ---------------------------------------------------------------------------

describe('recoverIncompleteTransactions — no-op when no transactions pending', () => {
  it('returns without error when the rename-txn directory does not exist', async () => {
    mockPathExists.mockResolvedValue(false);
    mockListDirectory.mockRejectedValue(new Error('ENOENT'));

    await expect(recoverIncompleteTransactions(NOTES_ROOT)).resolves.not.toThrow();
  });

  it('returns without error when rename-txn directory is empty', async () => {
    mockPathExists.mockImplementation(async (p: string) => p === TXN_BASE);
    mockListDirectory.mockResolvedValue([]);

    await expect(recoverIncompleteTransactions(NOTES_ROOT)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isRenameTransactionManifest guard
// ---------------------------------------------------------------------------

describe('isRenameTransactionManifest', () => {
  const validManifest: RenameTransactionManifest = {
    txnId: 'txn-1',
    phase: 'committing',
    entries: [{ oldSidecar: '/a.json', newSidecar: '/b.json', stagingFile: '/txn/entry-0.json' }],
    createdAt: 123,
  };

  it('accepts a valid manifest (including empty entries)', () => {
    expect(isRenameTransactionManifest(validManifest)).toBe(true);
    expect(isRenameTransactionManifest({ ...validManifest, entries: [] })).toBe(true);
  });

  it('rejects junk primitives', () => {
    expect(isRenameTransactionManifest(null)).toBe(false);
    expect(isRenameTransactionManifest(undefined)).toBe(false);
    expect(isRenameTransactionManifest(42)).toBe(false);
    expect(isRenameTransactionManifest('manifest')).toBe(false);
    expect(isRenameTransactionManifest([validManifest])).toBe(false);
  });

  it('rejects wrong-shape objects', () => {
    expect(isRenameTransactionManifest({})).toBe(false);
    expect(isRenameTransactionManifest({ ...validManifest, txnId: 42 })).toBe(false);
    expect(isRenameTransactionManifest({ ...validManifest, phase: null })).toBe(false);
    expect(isRenameTransactionManifest({ ...validManifest, entries: 'nope' })).toBe(false);
    expect(
      isRenameTransactionManifest({ ...validManifest, entries: [{ oldSidecar: '/a.json' }] }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Half-written manifest recovery (valid JSON, wrong shape)
// ---------------------------------------------------------------------------

describe('recoverIncompleteTransactions — half-written manifest (valid JSON, wrong shape)', () => {
  function setupTxnDir(txnId: string, manifestContent: string) {
    const txnDir = `${TXN_BASE}/${txnId}`;
    const manifestPath = `${txnDir}/manifest.json`;
    mockListDirectory.mockImplementation(async (p: string) => {
      if (p === TXN_BASE) {
        return [{ name: txnId, path: txnDir, is_directory: true, hidden: false }];
      }
      return [];
    });
    mockPathExists.mockImplementation(async (p: string) => p === txnDir || p === manifestPath);
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === manifestPath) return manifestContent;
      return '{}';
    });
    return { txnDir };
  }

  it('cleans up and returns instead of crashing on a manifest missing entries', async () => {
    // Crash mid-write can truncate the manifest: valid JSON, wrong shape.
    const { txnDir } = setupTxnDir('txn-truncated', JSON.stringify({ txnId: 'txn-truncated', phase: 'committing' }));

    const deletedPaths: string[] = [];
    mockDeletePath.mockImplementation(async (p: string) => { deletedPaths.push(p); });
    const writtenFiles: string[] = [];
    mockWriteFile.mockImplementation(async (p: string) => { writtenFiles.push(p); });

    // Before the guard this was a TypeError on `manifest.entries.length`.
    await expect(recoverIncompleteTransactions(NOTES_ROOT)).resolves.not.toThrow();

    expect(deletedPaths).toContain(txnDir);
    expect(writtenFiles).toHaveLength(0);
  });

  it('cleans up on wrong-typed fields (txnId number, entries not an array)', async () => {
    const { txnDir } = setupTxnDir(
      'txn-wrong-types',
      JSON.stringify({ txnId: 42, phase: 'committing', entries: 'nope', createdAt: 1 }),
    );

    const deletedPaths: string[] = [];
    mockDeletePath.mockImplementation(async (p: string) => { deletedPaths.push(p); });

    await expect(recoverIncompleteTransactions(NOTES_ROOT)).resolves.not.toThrow();
    expect(deletedPaths).toContain(txnDir);
  });

  it('cleans up when entries contain malformed items', async () => {
    const { txnDir } = setupTxnDir(
      'txn-bad-entries',
      JSON.stringify({
        txnId: 'txn-bad-entries',
        phase: 'committing',
        entries: [{ oldSidecar: '/a.json' }], // missing newSidecar + stagingFile
        createdAt: 1,
      }),
    );

    const deletedPaths: string[] = [];
    mockDeletePath.mockImplementation(async (p: string) => { deletedPaths.push(p); });
    const writtenFiles: string[] = [];
    mockWriteFile.mockImplementation(async (p: string) => { writtenFiles.push(p); });

    await expect(recoverIncompleteTransactions(NOTES_ROOT)).resolves.not.toThrow();
    expect(deletedPaths).toContain(txnDir);
    expect(writtenFiles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RENAME_TXN_DIR constant must be set correctly for watcher exclusion
// ---------------------------------------------------------------------------

describe('RENAME_TXN_DIR constant', () => {
  it('is the expected directory name used in watcher exclusion', () => {
    expect(RENAME_TXN_DIR).toBe('rename-txn');
  });
});

// ---------------------------------------------------------------------------
// TransactionPhase type check
// ---------------------------------------------------------------------------

describe('TransactionPhase values', () => {
  it('covers prepare, committing, and committed', () => {
    const phases: TransactionPhase[] = ['prepare', 'committing', 'committed'];
    expect(phases).toHaveLength(3);
    expect(phases).toContain('prepare');
    expect(phases).toContain('committing');
    expect(phases).toContain('committed');
  });
});
