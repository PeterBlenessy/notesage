/**
 * Crash-safe three-phase commit for path-keyed sidecar file migration.
 *
 * When a folder rename touches N path-keyed sidecar files sequentially, a
 * process kill mid-migration can leave sidecars in an inconsistent state.
 * This module wraps the migration in a transaction with staging so that:
 *
 *   - A crash during **prepare** (before "committing" is written) triggers a
 *     rollback on the next app start — old sidecars are left intact.
 *   - A crash during or after **committing** is detected on the next app start
 *     and the migration is resumed from the staging copies.
 *
 * Transaction directory layout:
 *
 *   <notesRoot>/.notesage/rename-txn/<txnId>/
 *     manifest.json          — phase + entry list
 *     entry-0.json           — staging copy of entry 0's sidecar content
 *     entry-1.json           — staging copy of entry 1's sidecar content
 *     ...
 *
 * The three phases:
 *   1. **prepare**    — create txn dir, copy sidecars to staging, write manifest
 *   2. **committing** — update manifest phase, apply destination writes + deletes
 *   3. **committed**  — remove the txn dir (cleanup)
 *
 * The watcher excludes `rename-txn/` by name so staging writes never trigger
 * spurious `file-changed-batch` events. See `watcher.rs` for the exclusion.
 */

import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';

/** Name of the staging directory under `.notesage/`. Also used by the watcher for exclusion. */
export const RENAME_TXN_DIR = 'rename-txn';

/** The three commit phases of a rename transaction. */
export type TransactionPhase = 'prepare' | 'committing' | 'committed';

/** A single sidecar entry inside a transaction. */
export interface RenameTransactionEntry {
  /** Absolute path to the old (source) sidecar. */
  oldSidecar: string;
  /** Absolute path to the new (destination) sidecar. */
  newSidecar: string;
  /** Absolute path to the staging copy inside the txn directory. */
  stagingFile: string;
}

/** The manifest written to `<txnDir>/manifest.json`. */
export interface RenameTransactionManifest {
  txnId: string;
  phase: TransactionPhase;
  entries: RenameTransactionEntry[];
  /** Unix ms timestamp for debugging / stale-txn detection. */
  createdAt: number;
}

/** Input descriptor for a single sidecar migration. */
export interface SidecarMigrationInput {
  /** Absolute path to the old sidecar. */
  oldSidecar: string;
  /** Absolute path to the destination sidecar. */
  newSidecar: string;
  /** The new document path (used to update `originalPath` in the sidecar envelope). */
  newFilePath: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function txnBasePath(notesRootPath: string): string {
  return `${notesRootPath}/.notesage/${RENAME_TXN_DIR}`;
}

function txnDirPath(notesRootPath: string, txnId: string): string {
  return `${txnBasePath(notesRootPath)}/${txnId}`;
}

function manifestPath(txnDir: string): string {
  return `${txnDir}/manifest.json`;
}

function generateTxnId(): string {
  return `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function writeManifest(txnDir: string, manifest: RenameTransactionManifest): Promise<void> {
  await tauriApi.writeFile(manifestPath(txnDir), JSON.stringify(manifest, null, 2));
}

/** Best-effort cleanup of a transaction directory. Never throws. */
async function cleanupTxnDir(txnDir: string): Promise<void> {
  try {
    await tauriApi.deletePath(txnDir);
  } catch (err) {
    log.warn('rename-transaction', `cleanup failed for ${txnDir}: ${err}`);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isTransactionEntry(v: unknown): v is RenameTransactionEntry {
  return (
    isRecord(v) &&
    typeof v.oldSidecar === 'string' &&
    typeof v.newSidecar === 'string' &&
    typeof v.stagingFile === 'string'
  );
}

/**
 * Runtime guard for a manifest read back from disk during crash recovery.
 * A crash can leave `manifest.json` half-written — valid JSON of the wrong
 * shape must trigger the same cleanup path as unparseable JSON, not a
 * TypeError on `manifest.entries.length`.
 */
export function isRenameTransactionManifest(v: unknown): v is RenameTransactionManifest {
  return (
    isRecord(v) &&
    typeof v.txnId === 'string' &&
    typeof v.phase === 'string' &&
    Array.isArray(v.entries) &&
    v.entries.every(isTransactionEntry)
  );
}

// ---------------------------------------------------------------------------
// executeRenameTransaction
// ---------------------------------------------------------------------------

/**
 * Execute a crash-safe rename of zero or more path-keyed sidecar files.
 *
 * Entries whose `oldSidecar` does not exist on disk are silently skipped.
 * The caller is responsible for determining which sidecars need migration.
 */
export async function executeRenameTransaction(
  notesRootPath: string,
  inputs: SidecarMigrationInput[],
): Promise<void> {
  if (inputs.length === 0) return;

  // Filter to entries where the old sidecar actually exists
  const existingInputs: SidecarMigrationInput[] = [];
  for (const input of inputs) {
    try {
      const exists = await tauriApi.pathExists(input.oldSidecar);
      if (exists) {
        existingInputs.push(input);
      }
    } catch {
      // path check failed — skip this entry
    }
  }

  if (existingInputs.length === 0) return;

  const txnId = generateTxnId();
  const txnDir = txnDirPath(notesRootPath, txnId);

  // -------------------------------------------------------------------------
  // PHASE 1: prepare
  // -------------------------------------------------------------------------

  try {
    await tauriApi.createDirectory(txnDir);
  } catch (err) {
    log.warn('rename-transaction', `failed to create txn dir ${txnDir}: ${err}`);
    // If we cannot create the txn dir, fall back to direct migration (unsafe but better than nothing)
    await directMigrate(existingInputs);
    return;
  }

  const entries: RenameTransactionEntry[] = [];
  const readContents: string[] = [];

  for (let i = 0; i < existingInputs.length; i++) {
    const input = existingInputs[i];
    const stagingFile = `${txnDir}/entry-${i}.json`;

    let content: string;
    try {
      content = await tauriApi.readFile(input.oldSidecar);
    } catch (err) {
      log.warn('rename-transaction', `failed to read ${input.oldSidecar}: ${err}`);
      continue;
    }

    // Update originalPath in the sidecar envelope if present
    let updatedContent = content;
    try {
      const parsed: unknown = JSON.parse(content);
      if (isRecord(parsed)) {
        parsed.originalPath = input.newFilePath;
        updatedContent = JSON.stringify(parsed, null, 2);
      }
    } catch {
      // not a parseable envelope — use raw content as-is
    }

    try {
      await tauriApi.writeFile(stagingFile, updatedContent);
    } catch (err) {
      log.warn('rename-transaction', `failed to write staging ${stagingFile}: ${err}`);
      await cleanupTxnDir(txnDir);
      return;
    }

    entries.push({ oldSidecar: input.oldSidecar, newSidecar: input.newSidecar, stagingFile });
    readContents.push(updatedContent);
  }

  if (entries.length === 0) {
    await cleanupTxnDir(txnDir);
    return;
  }

  const manifest: RenameTransactionManifest = {
    txnId,
    phase: 'prepare',
    entries,
    createdAt: Date.now(),
  };

  try {
    await writeManifest(txnDir, manifest);
  } catch (err) {
    log.warn('rename-transaction', `failed to write manifest for ${txnId}: ${err}`);
    await cleanupTxnDir(txnDir);
    return;
  }

  // -------------------------------------------------------------------------
  // PHASE 2: committing — mark manifest, then apply
  // -------------------------------------------------------------------------

  manifest.phase = 'committing';
  try {
    await writeManifest(txnDir, manifest);
  } catch (err) {
    log.warn('rename-transaction', `failed to mark committing for ${txnId}: ${err}`);
    await cleanupTxnDir(txnDir);
    return;
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const content = readContents[i];

    try {
      await tauriApi.writeFile(entry.newSidecar, content);
    } catch (err) {
      log.warn('rename-transaction', `failed to write dest ${entry.newSidecar}: ${err}`);
      // Continue — will be retried via recovery on next launch
      continue;
    }

    try {
      await tauriApi.deletePath(entry.oldSidecar);
    } catch (err) {
      log.warn('rename-transaction', `failed to delete old ${entry.oldSidecar}: ${err}`);
    }
  }

  // -------------------------------------------------------------------------
  // PHASE 3: committed — cleanup staging dir
  // -------------------------------------------------------------------------

  await cleanupTxnDir(txnDir);
}

// ---------------------------------------------------------------------------
// recoverIncompleteTransactions (startup recovery scan)
// ---------------------------------------------------------------------------

/**
 * Scan `<notesRoot>/.notesage/rename-txn/` for incomplete transactions and
 * recover them:
 *
 * - **phase === "prepare"**: process was killed before committing. Rollback:
 *   delete the staging dir. Old sidecars were never touched, so no data loss.
 *
 * - **phase === "committing"**: process was killed mid-commit. Resume: re-apply
 *   the destination writes from staging, delete old sidecars, then cleanup.
 *
 * - **phase === "committed"**: process was killed during cleanup. Just delete the
 *   staging dir.
 *
 * Silently swallows per-transaction errors so a corrupted manifest cannot block
 * startup.
 */
export async function recoverIncompleteTransactions(notesRootPath: string): Promise<void> {
  const basePath = txnBasePath(notesRootPath);

  let txnDirs: Awaited<ReturnType<typeof tauriApi.listDirectory>>;
  try {
    txnDirs = await tauriApi.listDirectory(basePath);
  } catch {
    // The rename-txn dir doesn't exist yet — nothing to recover
    return;
  }

  for (const entry of txnDirs) {
    if (!entry.is_directory) continue;
    await recoverSingleTransaction(entry.path).catch((err) => {
      log.warn('rename-transaction', `recovery failed for ${entry.path}: ${err}`);
    });
  }
}

async function recoverSingleTransaction(txnDir: string): Promise<void> {
  const mPath = manifestPath(txnDir);

  let raw: string;
  try {
    raw = await tauriApi.readFile(mPath);
  } catch {
    // No manifest — corrupted txn dir, clean up
    await cleanupTxnDir(txnDir);
    return;
  }

  let manifest: RenameTransactionManifest;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRenameTransactionManifest(parsed)) {
      // Half-written manifest (valid JSON, wrong shape) — same recovery as a
      // corrupted manifest: staging is discarded, old sidecars stay intact.
      log.warn('rename-transaction', `invalid manifest shape in ${txnDir} — cleaning up`);
      await cleanupTxnDir(txnDir);
      return;
    }
    manifest = parsed;
  } catch {
    await cleanupTxnDir(txnDir);
    return;
  }

  log.info(
    'rename-transaction',
    `recovering txn ${manifest.txnId} phase=${manifest.phase} entries=${manifest.entries.length}`,
  );

  switch (manifest.phase) {
    case 'prepare':
      // Crashed before committing — rollback by just cleaning up staging.
      // Old sidecars were never modified.
      await cleanupTxnDir(txnDir);
      break;

    case 'committing':
      // Crashed mid-commit — resume from staging files.
      for (const entry of manifest.entries) {
        try {
          let content: string;
          try {
            content = await tauriApi.readFile(entry.stagingFile);
          } catch {
            // Staging file is missing — skip this entry
            continue;
          }

          await tauriApi.writeFile(entry.newSidecar, content);

          // Delete old sidecar if it still exists (idempotent)
          try {
            const oldExists = await tauriApi.pathExists(entry.oldSidecar);
            if (oldExists) {
              await tauriApi.deletePath(entry.oldSidecar);
            }
          } catch {
            // best-effort
          }
        } catch (err) {
          log.warn('rename-transaction', `recovery entry failed ${entry.newSidecar}: ${err}`);
        }
      }
      await cleanupTxnDir(txnDir);
      break;

    case 'committed':
      // Committed but cleanup didn't finish — just delete the staging dir.
      await cleanupTxnDir(txnDir);
      break;
  }
}

// ---------------------------------------------------------------------------
// directMigrate — fallback (no staging available)
// ---------------------------------------------------------------------------

/** Non-transactional fallback for when the txn dir cannot be created. */
async function directMigrate(inputs: SidecarMigrationInput[]): Promise<void> {
  for (const input of inputs) {
    try {
      const content = await tauriApi.readFile(input.oldSidecar);

      // Update originalPath if present
      let updatedContent = content;
      try {
        const parsed: unknown = JSON.parse(content);
        if (isRecord(parsed)) {
          parsed.originalPath = input.newFilePath;
          updatedContent = JSON.stringify(parsed, null, 2);
        }
      } catch {
        // raw content
      }

      await tauriApi.writeFile(input.newSidecar, updatedContent);
      await tauriApi.deletePath(input.oldSidecar);
    } catch (err) {
      log.warn('rename-transaction', `direct migrate failed ${input.oldSidecar}: ${err}`);
    }
  }
}
