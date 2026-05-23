import type { AIProviderType, ImageAttachment } from './types';

export interface VisionCheckContext {
  /** Provider type from the connection */
  provider: AIProviderType | 'agent_managed';
  /** For ACP connections: whether the agent reported image support */
  acpSupportsImages?: boolean;
  /** For local_bundled: whether the model catalog entry has supports_vision */
  localModelSupportsVision?: boolean;
  /** For ollama: pre-fetched vision support from /api/show */
  ollamaSupportsVision?: boolean;
}

// ---------------------------------------------------------------------------
// Event bus for sending images from the editor to the command bar.
// ChatInput registers a handler on mount; the editor's SendToAI extension
// calls sendImageToChat() to inject an attachment into the cmd bar input.
// ---------------------------------------------------------------------------

type SendImageHandler = (attachment: ImageAttachment) => void;
let _sendImageHandler: SendImageHandler | null = null;

/** Register the callback that receives images destined for the chat input. */
export function registerSendImageHandler(handler: SendImageHandler): void {
  _sendImageHandler = handler;
}

/** Unregister the current handler (call on unmount). */
export function unregisterSendImageHandler(): void {
  _sendImageHandler = null;
}

/** Push an image attachment into the chat input from anywhere in the app. */
export function sendImageToChat(attachment: ImageAttachment): void {
  if (_sendImageHandler) {
    _sendImageHandler(attachment);
  }
}

/**
 * Determines whether the active connection supports image input.
 *
 * This is a synchronous check using pre-fetched capability data.
 * Callers should fetch the async data (Ollama, ACP) ahead of time.
 */
export function supportsVision(ctx: VisionCheckContext): boolean {
  switch (ctx.provider) {
    case 'anthropic':
      return true; // Claude 3+ all support vision
    case 'openai':
      return true; // GPT-4o+ all support vision
    case 'google':
      return true; // Gemini models support vision
    case 'openai_compatible':
      return true; // Can't reliably detect; assume capable
    case 'ollama':
      return ctx.ollamaSupportsVision ?? false;
    case 'local_bundled':
      return ctx.localModelSupportsVision ?? false;
    case 'agent_managed':
      return ctx.acpSupportsImages ?? false;
    default:
      return false;
  }
}
