import { tauriApi } from '@/lib/tauri';

// Lazy-resolved home directory for path filtering / tool-executor scope.
// The value never changes for the lifetime of the process, so a simple
// module-level cache is safe.
let cachedHomeDir: string | null = null;

export async function getHomeDir(): Promise<string> {
  if (!cachedHomeDir) {
    cachedHomeDir = await tauriApi.getHomeDir();
  }
  return cachedHomeDir;
}
