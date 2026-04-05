/**
 * ProseMirror plugin that adds a "Add to chat" context menu item
 * on image and drawing nodes.  Clicking the item compresses the image,
 * injects it into the chat input via the sendImageToChat event bus,
 * and opens the chat panel.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { compressImage } from '@/lib/image-compress';
import { sendImageToChat, supportsVision } from '@/lib/ai/vision';
import { useRoutingStore } from '@/stores/routing-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { tauriApi } from '@/lib/tauri';
import { toast } from 'sonner';
import type { VisionCheckContext } from '@/lib/ai/vision';

const sendToAIPluginKey = new PluginKey('sendToAI');

/** CSS class used to identify (and remove) existing menus. */
const MENU_CLASS = 'send-to-ai-context-menu';

function dismissMenu() {
  document.querySelector(`.${MENU_CLASS}`)?.remove();
}

/** Map ConnectionProvider names to AIProviderType names used by the vision check. */
const PROVIDER_MAP: Record<string, VisionCheckContext['provider']> = { local_ai: 'local_bundled' };

/** Check whether the currently routed interactive connection supports vision. */
function isVisionAvailable(): boolean {
  const slot = useRoutingStore.getState().routing.interactive;
  if (!slot?.connectionId) return false;
  const conn = useConnectionsStore.getState().getConnection(slot.connectionId);
  if (!conn) return false;
  const provider = (PROVIDER_MAP[conn.provider] ?? conn.provider) as VisionCheckContext['provider'];
  const ctx: VisionCheckContext = { provider };
  if (provider === 'local_bundled') {
    const { models, activeModelId } = useLocalAIStore.getState();
    const activeModel = models.find((m) => m.id === activeModelId);
    ctx.localModelSupportsVision = activeModel?.supports_vision ?? false;
  }
  return supportsVision(ctx);
}

/** Show a tiny context menu at (x, y) with one "Add to chat" item. */
function showMenu(x: number, y: number, onSend: () => void) {
  dismissMenu();

  const menu = document.createElement('div');
  menu.className = MENU_CLASS;
  menu.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    z-index: 9999;
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 4px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    min-width: 160px;
  `;

  const item = document.createElement('div');
  item.textContent = 'Add to chat';
  item.style.cssText = `
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: background 150ms;
  `;
  item.addEventListener('mouseenter', () => {
    item.style.background = 'var(--color-accent)';
  });
  item.addEventListener('mouseleave', () => {
    item.style.background = 'transparent';
  });
  item.addEventListener('click', () => {
    dismissMenu();
    onSend();
  });

  menu.appendChild(item);
  document.body.appendChild(menu);

  // Dismiss on outside click or Escape
  const dismiss = () => {
    dismissMenu();
    document.removeEventListener('click', dismiss);
    document.removeEventListener('keydown', handleKey);
  };
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss();
  };
  setTimeout(() => {
    document.addEventListener('click', dismiss);
    document.addEventListener('keydown', handleKey);
  }, 0);
}

/** Open the chat panel via the settings store. */
function openChatPanel() {
  useSettingsStore.getState().setChatPanelOpen(true);
}

export const SendToAI = Extension.create({
  name: 'sendToAI',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: sendToAIPluginKey,
        props: {
          handleDOMEvents: {
            contextmenu: (view, event) => {
              dismissMenu();

              if (!isVisionAvailable()) return false;

              const target = event.target as HTMLElement;

              // --- Regular image node ---
              const imgEl = target.closest('img');
              if (imgEl && !target.closest('.drawing-block') && !target.closest('.drawing-node-view') && view.dom.contains(imgEl)) {
                event.preventDefault();
                showMenu(event.clientX, event.clientY, async () => {
                  try {
                    const src = imgEl.getAttribute('src') ?? '';
                    if (!src) {
                      toast.error('Image source not available');
                      return;
                    }
                    // The src may be a Tauri asset URL, a data URI, or a relative path.
                    // compressImage accepts a string (treated as data URI / URL) or Blob.
                    // For asset:// or http:// URLs we load via fetch to get a Blob.
                    let attachment;
                    if (src.startsWith('data:')) {
                      attachment = await compressImage(src);
                    } else {
                      const resp = await fetch(src);
                      const blob = await resp.blob();
                      attachment = await compressImage(blob, { name: 'image.png' });
                    }
                    sendImageToChat(attachment);
                    openChatPanel();
                    toast.success('Image added to chat');
                  } catch {
                    toast.error('Failed to process image');
                  }
                });
                return true;
              }

              // --- Drawing node ---
              const drawingEl = target.closest('.drawing-node-view') ?? target.closest('.drawing-block');
              if (drawingEl && view.dom.contains(drawingEl)) {
                event.preventDefault();
                showMenu(event.clientX, event.clientY, async () => {
                  try {
                    // Try to get the SVG content from the preview image already in the DOM
                    const svgEl = drawingEl.querySelector('img');
                    if (svgEl) {
                      const src = svgEl.getAttribute('src') ?? '';
                      if (src) {
                        let attachment;
                        if (src.startsWith('data:')) {
                          attachment = await compressImage(src, { name: 'drawing.png' });
                        } else {
                          const resp = await fetch(src);
                          const blob = await resp.blob();
                          attachment = await compressImage(blob, { name: 'drawing.png' });
                        }
                        sendImageToChat(attachment);
                        openChatPanel();
                        toast.success('Drawing added to chat');
                        return;
                      }
                    }

                    // Fallback: read SVG file from disk and convert
                    const drawingIdAttr = drawingEl.getAttribute('data-drawing-id')
                      ?? drawingEl.querySelector('[data-drawing-id]')?.getAttribute('data-drawing-id');
                    if (!drawingIdAttr) {
                      toast.error('Drawing not found');
                      return;
                    }
                    // The drawingId is an .excalidraw path — the SVG lives at the same path with .svg extension
                    const svgPath = drawingIdAttr.replace(/\.excalidraw$/, '.svg');
                    const svgContent = await tauriApi.readFile(svgPath);
                    const svgBlob = new Blob([svgContent], { type: 'image/svg+xml' });
                    const attachment = await compressImage(svgBlob, { name: 'drawing.png' });
                    sendImageToChat(attachment);
                    openChatPanel();
                    toast.success('Drawing added to chat');
                  } catch {
                    toast.error('Failed to process drawing');
                  }
                });
                return true;
              }

              return false;
            },
          },
        },
      }),
    ];
  },
});
