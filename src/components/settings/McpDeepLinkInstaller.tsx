import { useEffect, useState } from 'react';
import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
import { toast } from 'sonner';
import { AddEditServerDialog, type CatalogPrefill } from './McpServersSettings';
import { parseMcpInstallUrl } from '@/lib/mcp/deeplink';

/**
 * Listens for `notesage://mcp/install` deep links and opens the validate-first
 * MCP Add dialog pre-filled with the requested server. The dialog is the
 * confirmation step — nothing is written until the user tests + adds. Mounted
 * once at the app root; independent of whether Settings is open.
 */
export function McpDeepLinkInstaller() {
  const [pending, setPending] = useState<CatalogPrefill | null>(null);

  useEffect(() => {
    const handle = (urls: string[]) => {
      for (const u of urls) {
        const res = parseMcpInstallUrl(u);
        if (!res) continue; // Not an install URL — ignore silently.
        if (!res.ok) {
          // Well-formed install URL, but the command isn't allowed. Refuse
          // loudly and never open the dialog.
          toast.error(res.reason);
          break;
        }
        setPending(res.prefill);
        break;
      }
    };

    // Cold-start: the app may have been launched by the deep link.
    getCurrent()
      .then((urls) => {
        if (urls && urls.length) handle(urls);
      })
      .catch(() => {});

    // Warm: links delivered while the app is running.
    let unlisten: (() => void) | undefined;
    onOpenUrl(handle)
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => unlisten?.();
  }, []);

  return (
    <AddEditServerDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      prefill={pending ?? undefined}
    />
  );
}
