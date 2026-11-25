import { invoke } from '@tauri-apps/api/core';

/**
 * Keychain housekeeping for MCP servers. A server's secrets (env values,
 * header values, its OAuth token) are stored under names that contain the
 * server id, so anything that changes the id has to move them.
 */

/** Read one keychain entry; `null` when it is absent or cannot be read. */
export async function readCredential(service: string): Promise<string | null> {
  try {
    return (await invoke<string | null>('get_credential', { service })) || null;
  } catch {
    return null;
  }
}

/** Best-effort removal of one keychain entry. */
export async function deleteCredential(service: string): Promise<void> {
  try {
    await invoke('delete_credential', { service });
  } catch {
    // Already absent, or the keychain refused: nothing more to do here.
  }
}

/**
 * Move a keychain entry to a new name. Returns false when there was nothing
 * to move. The old entry is only removed once the new one is stored.
 */
export async function moveCredential(from: string, to: string): Promise<boolean> {
  if (from === to) return false;
  const value = await readCredential(from);
  if (!value) return false;
  await invoke('store_credential', { service: to, key: value });
  await deleteCredential(from);
  return true;
}
