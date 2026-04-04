# PRD: Image Attachments for Multi-Modal AI Chat

|  |  |
| --- | --- |
| **Date** | 2026-04-04 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Users can include images in AI chat across all providers, enabling visual context for code review, UI feedback, document analysis, and drawing-to-code workflows |
| **Research** | [docs/research/2026-04-03-image-attachments.md](../research/2026-04-03-image-attachments.md) |

## Problem

Notesage supports multi-modal AI providers (Anthropic Claude, OpenAI GPT-4o, Ollama vision models, local bundled vision models, and all four ACP agents) but has no way to include images in chat messages. Users cannot paste screenshots, attach files, or reference document images when conversing with AI. This is table-stakes functionality — every competing tool (Cursor, Cline, Continue.dev, Windsurf, Claude Desktop, ChatGPT Desktop) supports image attachments.

Additionally, Notesage has a unique opportunity: images and Excalidraw drawings already exist inline in documents. No competing tool offers a "send this document image to AI" flow — all require manual copy-paste. Notesage can be the first.

## Goals

1. Users can attach images to chat messages via paste, drag-drop, and file picker across all vision-capable providers
2. Images are automatically compressed client-side to prevent API limit errors (no tool does this today — a differentiator)
3. The attachment UI is vision-capability-gated: hidden/disabled when the active model does not support images
4. Images in the editor (Image nodes, Drawing SVGs) can be sent to AI via right-click context menu
5. Image attachments work across all four AI paths: Direct API, ACP, local bundled, and Ollama

## Non-Goals

- **Audio attachments** — ACP supports `AudioContent` but this is a separate feature
- **PDF/document attachments** — different from image vision; requires file upload APIs
- **Anthropic Files API** — upload-once optimization deferred to a future phase
- **Multi-turn image carry-forward** — images attach to a single turn only; not re-sent in subsequent turns
- **Screenshot capture tool** — only ChatGPT has this; low priority for a desktop editor
- **Image generation** — this PRD is about sending images to AI, not generating them

## User Stories

1. **As a user**, I want to paste a screenshot into the chat input and ask AI about it, so that I can get feedback on UI designs or error messages without describing them in text.

2. **As a user**, I want to drag an image file from Finder into the chat panel, so that I can share reference images with the AI.

3. **As a user**, I want to click an attachment button to browse for image files, so that I have a reliable fallback when paste/drag-drop isn't convenient.

4. **As a user**, I want to right-click an image or drawing in my document and select "Send to AI", so that I can ask the AI about content already in my notes without manually copying it.

5. **As a user**, I want my images automatically resized and compressed before sending, so that I never hit API size limit errors.

6. **As a user**, I want the attachment button to be hidden when my selected AI model doesn't support images, so that I don't waste time attaching images that can't be sent.

7. **As a user**, I want to see thumbnail previews of attached images before sending, so that I can verify the right images are included and remove any I don't want.

## Technical Approach

### Architecture Overview

Images flow through three layers:

1. **Input layer** (ChatInput) — captures images from paste/drop/picker/editor, compresses them, stores as `ImageAttachment[]` in component state
2. **Storage layer** (chat-store) — persists `attachments` on `ChatMessage` via Zustand persist
3. **Serialization layer** (Rust backend) — converts the internal format to provider-specific wire formats at send time

### Image Compression Pipeline (Frontend)

All images are processed before base64 encoding:

1. Load into `HTMLCanvasElement`
2. Resize so longest edge <= 1568px (Anthropic's optimal; server-side resize threshold)
3. If image has no transparency, convert to JPEG at 80% quality; otherwise keep PNG
4. Validate base64 size < 5 MB (Anthropic's limit — most restrictive provider)
5. If still too large, retry at 60% quality
6. Store as `ImageAttachment` with base64 data, MIME type, and display dimensions

Utility: `src/lib/image-compress.ts`

### Vision Capability Detection

Each AI path reports vision support differently. A unified `supportsVision()` function resolves this:

| Path | Detection method |
|------|------------------|
| Direct API (Anthropic) | Always `true` (Claude 3+ all support vision) |
| Direct API (OpenAI) | Always `true` (GPT-4o+ all support vision) |
| Direct API (Ollama) | Query `/api/show` for `"multimodal"` capability (extend existing `detect_thinking_support()` pattern) |
| ACP | Check `promptCapabilities.image` from agent init response (store on `AcpState`) |
| Local bundled | Check `supports_vision` in `model-catalog.json` (field already exists) |
| OpenAI-compatible | Assume `true` (user-configured endpoints; can't reliably detect) |

### Provider Serialization (Rust)

The `ai_chat_stream` command receives images as an optional field on `ChatMessage`. Each provider's request builder serializes them differently:

| Provider | Serialization |
|----------|---------------|
| Anthropic | `content[]` array: `{ type: "image", source: { type: "base64", media_type, data } }` before text blocks |
| OpenAI | `content[]` array: `{ type: "image_url", image_url: { url: "data:{mime};base64,{data}" } }` |
| Ollama (native) | `images: [base64_data]` on the message JSON object |
| Ollama (OAI compat) | Same as OpenAI via `/v1/chat/completions` |
| llama-server | Same as OpenAI via `/v1/chat/completions` |

### ACP Path

The `acp_session_prompt` command currently sends `vec![ContentBlock::Text(...)]`. To include images:

1. Store `promptCapabilities` from the ACP `initialize` response on `AcpState`
2. Add `images: Option<Vec<ImageData>>` parameter to `acp_session_prompt`
3. Build `Vec<ContentBlock>` with `ContentBlock::Image(ImageContent::new(data, mime))` blocks preceding `ContentBlock::Text`
4. The `agent-client-protocol` crate (0.10.4) already has `ImageContent` — no dependency changes

### Editor-to-Chat Flow

When a user right-clicks an image or drawing in the editor:

1. Context menu shows "Send to AI" option (only when chat panel is open and model supports vision)
2. For **Image nodes**: read the image source (local file path or URL), load via Tauri `read_file` or fetch, compress
3. For **Drawing nodes**: read the `.svg` sidecar file, rasterize to PNG via canvas, compress
4. Open chat panel if closed, populate `ChatInput` pending attachments
5. User types their question and sends — image is attached to that message

## UI/UX

### Chat Input Attachments

**Attachment button:** A small image icon (lucide `ImagePlus`, strokeWidth 1.5) appears to the left of the send button in `ChatInput`. Hidden when the active provider/model does not support vision. Tooltip: "Attach image".

**Attachment strip:** When images are pending, a horizontal strip of thumbnails appears above the textarea, below any context items. Each thumbnail is 48x48px with rounded corners (6px), object-fit cover. Hover shows an X button (top-right corner) to remove. Maximum 5 images per message.

**Paste handling:** Intercept `paste` event on the textarea. If `clipboardData.files` contains images, compress and add to pending attachments. If text and images are pasted simultaneously, handle both.

**Drag-drop:** The chat input area accepts drag-drop of image files. A subtle dashed border highlight (using `--border` color) appears on dragover. Drop adds images to pending attachments.

**File picker:** Clicking the attachment button opens a native file dialog (via Tauri `dialog.open()`) filtered to image types (JPEG, PNG, GIF, WebP).

**States:**
- **No attachments:** Button visible (if vision-capable), strip hidden
- **With attachments:** Strip visible with thumbnails, badge count on button
- **Sending:** Thumbnails show a subtle opacity reduction during upload
- **Non-vision model:** Button hidden, paste handler rejects images with toast: "Current model doesn't support images"

### Sent Message Display

After sending, user messages with attachments show inline thumbnail previews above the message text. Thumbnails are 120px max-width, rounded corners, clickable to open full-size in a modal or native preview.

### Editor Context Menu

Image and Drawing nodes gain a context menu item: "Send to AI" (with a `MessageSquare` icon). Disabled if no vision-capable provider is active. Clicking opens/focuses the chat panel and adds the image to pending attachments.

### Design System Compliance

- All colors from CSS variables (no hardcoded values)
- Thumbnails use `border-radius: var(--radius)` (6px)
- Remove button: `text-muted-foreground` on hover, 150ms transition
- Drag-drop highlight: `border: 1px dashed var(--border)` with `bg-muted/50` overlay
- Dark mode: thumbnails on `bg-muted` background, no bright borders
- Attachment button: same style as existing chat footer controls (muted, 16px icon)

## Data Model

### TypeScript (Frontend)

```typescript
// src/lib/ai/types.ts — new type
export interface ImageAttachment {
  /** Unique ID for React keys and removal */
  id: string;
  /** Base64-encoded image data (after compression) */
  data: string;
  /** MIME type: "image/jpeg" | "image/png" | "image/gif" | "image/webp" */
  mimeType: string;
  /** Display width in pixels (post-compression) */
  width: number;
  /** Display height in pixels (post-compression) */
  height: number;
  /** Original filename if from file picker/drop, undefined if from paste */
  name?: string;
  /** Base64 byte size (for UI display, e.g. "340 KB") */
  size: number;
}

// src/lib/ai/types.ts — extend existing ChatMessage
export interface ChatMessage {
  // ... all existing fields unchanged ...
  /** Image attachments on this message */
  attachments?: ImageAttachment[];
}
```

### Rust (Backend)

```rust
// src-tauri/src/commands/ai.rs — new struct
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ImageData {
    pub data: String,       // base64-encoded
    pub mime_type: String,  // "image/jpeg", "image/png", etc.
}

// src-tauri/src/commands/ai.rs — extend existing ChatMessage
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<ImageData>>,  // NEW
}
```

### ACP State Extension

```rust
// src-tauri/src/commands/acp.rs — extend AcpInstance or AcpState
pub struct AcpInstance {
    // ... existing fields ...
    pub supports_images: bool,  // NEW — from promptCapabilities.image
}
```

### Tauri Command Changes

```rust
// acp_session_prompt — add images parameter
pub async fn acp_session_prompt(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    content: String,
    images: Option<Vec<ImageData>>,  // NEW
) -> Result<(), String>
```

### New Utility

```typescript
// src/lib/image-compress.ts
export async function compressImage(
  source: File | Blob | string,  // File, Blob, or base64 string
  options?: { maxDimension?: number; quality?: number; maxBytes?: number }
): Promise<ImageAttachment>

export function supportsVision(connection: Connection, localModel?: ModelCatalogEntry): boolean
```

### Store Changes

The `chat-store` `ChatMessage` type gains the `attachments` field. Zustand persist handles this via optional field — old conversations without `attachments` continue to work. No migration needed.

`ChatInput.onSend` signature changes from `(message: string) => void` to `(message: string, attachments?: ImageAttachment[]) => void`.

## Dependencies

**No new npm or Cargo dependencies required.**

- Image compression uses native `HTMLCanvasElement` / `canvas.toBlob()` — no library needed
- ACP image support uses existing `agent-client-protocol` crate's `ImageContent` type
- File picker uses existing Tauri `dialog` plugin
- All provider APIs already support images — this is a client-side feature

## Quality Gates

### Functional

- [ ] Paste image from clipboard into chat input shows thumbnail preview
- [ ] Drag image file onto chat input shows thumbnail preview
- [ ] Click attachment button opens native file dialog filtered to images
- [ ] Removing a thumbnail from the strip works (X button)
- [ ] Sending a message with image(s) works with Anthropic provider
- [ ] Sending a message with image(s) works with OpenAI provider
- [ ] Sending a message with image(s) works with Ollama (vision model)
- [ ] Sending a message with image(s) works with local bundled (vision model)
- [ ] Sending a message with image(s) works via ACP (any agent)
- [ ] Images > 1568px longest edge are resized before sending
- [ ] Images > 5 MB after compression are re-compressed at lower quality
- [ ] Attachment button is hidden when active model doesn't support vision
- [ ] Pasting an image with a non-vision model shows "doesn't support images" toast
- [ ] Switching from vision to non-vision model with pending attachments clears them with toast
- [ ] Right-click image in editor shows "Send to AI" context menu item
- [ ] Right-click drawing in editor shows "Send to AI" context menu item
- [ ] Sent messages display inline image thumbnails
- [ ] Image attachments persist in chat history (Zustand persist)
- [ ] Old conversations without attachments render correctly (backward compat)
- [ ] Maximum 5 images per message enforced

### Design

- [ ] Attachment strip thumbnails are 48x48px rounded, consistent spacing
- [ ] Thumbnail remove button only visible on hover with 150ms transition
- [ ] Drag-drop highlight uses dashed border, no chromatic colors
- [ ] All colors from CSS variables, works in light and dark mode
- [ ] Attachment button matches existing chat footer control styling
- [ ] Sent message thumbnails are max 120px wide, rounded, clickable
- [ ] No layout shift when attaching/removing images

### Testing

- [ ] Unit test: `compressImage` resizes to max dimension
- [ ] Unit test: `compressImage` converts PNG without transparency to JPEG
- [ ] Unit test: `compressImage` preserves PNG with transparency
- [ ] Unit test: `supportsVision` returns correct value for each provider type
- [ ] Unit test: Provider serializers produce correct wire format (Anthropic, OpenAI, Ollama, ACP)
- [ ] Unit test: ChatMessage with attachments round-trips through Zustand persist
- [ ] Rust test: `ChatMessage` with images serializes correctly for each provider
- [ ] Rust test: `acp_session_prompt` builds correct `ContentBlock::Image` blocks

## Out of Scope

- **Audio attachments** — ACP supports it but requires separate UX (record button, playback)
- **Anthropic Files API** — upload-once optimization for multi-turn cost reduction; Phase 2
- **Multi-turn image carry-forward** — images only on the turn they're attached; no auto re-send
- **Image generation** — generating images from AI responses
- **Screenshot capture tool** — built-in screen capture like ChatGPT Desktop
- **Image editing** — crop, annotate, or markup before sending
- **Video attachments** — not supported by any provider API
- **Inline image output from AI** — AI-generated images displayed in chat
- **Comment delegation with images** — attaching images when delegating comments to agents
