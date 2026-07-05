import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ImageAttachment } from "@/lib/ai/types";
import { compressImage } from "@/lib/image-compress";
import {
  registerSendImageHandler,
  unregisterSendImageHandler,
} from "@/lib/ai/vision";

export interface UsePendingImageAttachmentsArgs {
  /** Composer textarea ref — focused after a vision-bus image arrives. */
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Expand the bar when an image arrives via the vision event bus. */
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface PendingImageAttachments {
  pendingAttachments: ImageAttachment[];
  addImageAttachment: (att: ImageAttachment) => void;
  removeImageAttachment: (id: string) => void;
  /** Clear the strip (called by `handleSend` after handing them off). */
  clearPendingAttachments: () => void;
  /** #126 — open the native image picker dialog. */
  handleImagePick: () => Promise<void>;
}

/**
 * usePendingImageAttachments — the FloatingCommandBar's image-attachment
 * cluster (#126 parity). Paste, drag-drop, and the file picker all dump
 * ImageAttachments into this state; `handleSend` then hands them to
 * `sendChatMessage` where the Rust backend serializes them per-provider.
 * Cleared on successful send. Thumbnail rendering happens inline in
 * `ExpandedContent`.
 */
export function usePendingImageAttachments({
  inputRef,
  setExpanded,
}: UsePendingImageAttachmentsArgs): PendingImageAttachments {
  const [pendingAttachments, setPendingAttachments] = useState<
    ImageAttachment[]
  >([]);
  const addImageAttachment = useCallback((att: ImageAttachment) => {
    setPendingAttachments((prev) => {
      // Cap at 5 to match ChatInput's limit (user-facing toast if we
      // hit it — simpler than growing the strip unboundedly).
      if (prev.length >= 5) {
        toast.error("Max 5 images per message");
        return prev;
      }
      return [...prev, att];
    });
  }, []);
  const removeImageAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);
  const clearPendingAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);

  // #126 parity — subscribe to the vision event bus so editor "Add to
  // chat" actions and sidebar drops route their images into the
  // composer. Mounted once per bar instance — the bus rejects
  // duplicate registrations.
  useEffect(() => {
    registerSendImageHandler((attachment) => {
      addImageAttachment(attachment);
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => unregisterSendImageHandler();
  }, [addImageAttachment, inputRef, setExpanded]);

  // #126 parity — pick images via the native dialog. Mirrors
  // `ChatInput.handleAttachClick`: read bytes + compress + push to the
  // strip. The file dialog is dynamically imported so the Tauri plugin
  // only loads when the user actually clicks the button.
  const handleImagePick = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        try {
          const bytes = await (await import("@/lib/tauri")).tauriApi.readBinaryFile(path);
          const name = path.split("/").pop() ?? "image";
          const ext = name.split(".").pop()?.toLowerCase() ?? "";
          const mimeMap: Record<string, string> = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            webp: "image/webp",
            bmp: "image/bmp",
            svg: "image/svg+xml",
          };
          const blob = new Blob([new Uint8Array(bytes)], {
            type: mimeMap[ext] ?? "image/png",
          });
          const attachment = await compressImage(blob, { name });
          addImageAttachment(attachment);
        } catch (err) {
          toast.error(`Failed to attach ${path}: ${err}`);
        }
      }
    } catch (err) {
      toast.error(`Failed to open image picker: ${err}`);
    }
  }, [addImageAttachment]);

  return {
    pendingAttachments,
    addImageAttachment,
    removeImageAttachment,
    clearPendingAttachments,
    handleImagePick,
  };
}
