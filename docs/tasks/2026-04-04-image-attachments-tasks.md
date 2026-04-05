# Tasks: Image Attachments for Multi-Modal AI Chat

|  |  |
| --- | --- |
| **Date** | 2026-04-04 |
| **Status** | Complete |
| **PRD** | [image-attachments](../prds/2026-04-04-image-attachments.md) |
| **Total** | 14 tasks: 4S, 6M, 4L |
| **Suggested order** | Types (#1) -&gt; Compression (#2) -&gt; Vision detection (#3) -&gt; Backend (#4-#7) -&gt; Frontend state (#8) -&gt; UI (#9-#12) -&gt; Editor flow (#13) -&gt; Tests (#14) |

**Risks:**

- Ollama vision detection depends on `/api/show` response shape — test with real multimodal models (llava, SmolVLM)
- ACP `promptCapabilities` may not be exposed by all agent versions — graceful fallback to `false` needed
- Canvas-based compression in Tauri's WKWebView may behave differently than Chromium — test JPEG quality output

---

## Task 1: Add ImageAttachment type and extend ChatMessage ✅

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Description:** Add the `ImageAttachment` interface and the `attachments` optional field to `ChatMessage`. This is the foundation every other task depends on.

**Files:**

- `src/lib/ai/types.ts` — Add `ImageAttachment` interface (id, data, mimeType, width, height, name?, size). Add `attachments?: ImageAttachment[]` to `ChatMessage` (line \~131).

**Acceptance criteria:**

- `ImageAttachment` interface exported from `types.ts`
- `ChatMessage.attachments` is optional — existing code unaffected
- TypeScript compiles cleanly (`pnpm typecheck`)

---

## Task 2: Create image compression utility ✅

**Complexity:** M | **Category:** frontend | **Dependencies:** #1

**Description:** Build `src/lib/image-compress.ts` with a `compressImage()` function that loads an image source (File, Blob, or base64 string), resizes to max 1568px longest edge, converts to JPEG 80% (or keeps PNG if transparent), validates &lt;5 MB, and retries at 60% if too large. Returns an `ImageAttachment`.

Also add a `hasTransparency()` helper that draws the image to a small canvas and checks for alpha &lt; 255 pixels.

**Files:**

- `src/lib/image-compress.ts` — New file

**Acceptance criteria:**

- `compressImage(source, options?)` returns `Promise<ImageAttachment>`
- Large images (&gt;1568px) are resized proportionally
- PNGs without transparency become JPEG
- PNGs with transparency stay PNG
- Result is always &lt; 5 MB (retries at lower quality)
- Works with File, Blob, and base64 string inputs

---

## Task 3: Create vision capability detection utility ✅

**Complexity:** S | **Category:** frontend | **Dependencies:** #1

**Description:** Build a `supportsVision()` function that determines whether the active connection supports image input. This is used to show/hide the attachment UI.

**Files:**

- `src/lib/ai/vision.ts` — New file with `supportsVision(connection, ollamaModelInfo?, localModel?)` function

**Logic:**

- `anthropic` → always `true`
- `openai` → always `true`
- `openai_compatible` → always `true` (can't reliably detect; assume capable)
- `ollama` → check for multimodal capability from `/api/show` response (extend existing pattern in `ai_streaming.rs` — but this is a frontend utility, so check a stored model info object, not a live API call)
- `local_bundled` → check `supports_vision` from model catalog entry (field already exists)
- `agent_managed` (ACP) → check `supports_images` flag from stored ACP instance info (depends on #6)

**Acceptance criteria:**

- Returns `boolean`
- Each provider path covered
- Defaults to `false` for unknown providers

---

## Task 4: Add ImageData struct to Rust ChatMessage ✅

**Complexity:** S | **Category:** backend | **Dependencies:** None

**Description:** Add the `ImageData` struct and an optional `images` field to the Rust `ChatMessage` in `ai.rs`. This lets the frontend pass image data through IPC.

**Files:**

- `src-tauri/src/commands/ai.rs` — Add `ImageData` struct after `ChatMessage` (line \~76). Add `images: Option<Vec<ImageData>>` field to `ChatMessage` with `#[serde(skip_serializing_if = "Option::is_none")]`.

**Acceptance criteria:**

- `ImageData { data: String, mime_type: String }` with Serialize, Deserialize, Clone, Debug
- `ChatMessage.images` is `Option<Vec<ImageData>>`, skipped when None
- Existing `ai_chat_stream` callers unaffected (None default)
- `cargo test` passes

---

## Task 5: Implement provider-specific image serialization in Rust ✅

**Complexity:** L | **Category:** backend | **Dependencies:** #4

**Description:** Modify each provider's streaming function to include images in the request body when `ChatMessage.images` is `Some`. Each provider has a different wire format.

**Files:**

- `src-tauri/src/commands/ai.rs` — Modify `anthropic_chat_stream`, `openai_chat_stream`, `ollama_chat_stream`, `openai_compatible_chat_stream`, `local_bundled_chat_stream`

**Per-provider changes:**

**Anthropic** (`anthropic_chat_stream`):

- When building the message JSON, if `images` is present, convert `content` from a plain string to a `content[]` array with image blocks before text:

  ```json
  "content": [
    { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "..." } },
    { "type": "text", "text": "user message" }
  ]
  ```

**OpenAI / OpenAI-compatible / Local bundled** (`openai_chat_stream`, `openai_compatible_chat_stream`, `local_bundled_chat_stream`):

- When building the message JSON, if `images` is present, convert `content` from a plain string to a `content[]` array:

  ```json
  "content": [
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } },
    { "type": "text", "text": "user message" }
  ]
  ```

**Ollama native** (`ollama_chat_stream`):

- Add `"images": ["<base64>", ...]` to the message JSON object alongside `content`.

**Acceptance criteria:**

- Images are serialized correctly per provider
- Messages without images produce the same JSON as before (backward compat)
- Text-only messages are unchanged (no content array wrapping when no images)

---

## Task 6: Store ACP promptCapabilities and send images via ACP ✅

**Complexity:** M | **Category:** backend | **Dependencies:** #4

**Description:** Capture `promptCapabilities.image` from the ACP `initialize` response and store it on the agent instance. Extend `acp_session_prompt` to accept and forward images as `ContentBlock::Image`.

**Files:**

- `src-tauri/src/commands/acp.rs` — Modify `AgentHandle` or managed state to store `supports_images: bool`. Extract from initialize response (line \~428). Modify `acp_session_prompt` (line \~1153) to accept `images: Option<Vec<ImageData>>` parameter. Build `ContentBlock::Image(ImageContent::new(data, mime))` blocks when images are provided.
- `src-tauri/src/commands/acp_client.rs` — If `promptCapabilities` is available on the init response type, extract it. If not in the current crate version, default to `false`.

**Acceptance criteria:**

- `supports_images` stored per ACP agent instance after `initialize`
- `acp_session_prompt` accepts optional images parameter
- Images are sent as `ContentBlock::Image` before `ContentBlock::Text`
- Agents without image support still work (text-only fallback)
- New Tauri command `acp_supports_images(instance_id)` → `bool` so frontend can query

---

## Task 7: Expose ACP vision capability to frontend ✅

**Complexity:** S | **Category:** both | **Dependencies:** #6

**Description:** Add a Tauri command to query whether an ACP agent supports images, and wire it into the frontend vision detection.

**Files:**

- `src-tauri/src/commands/acp.rs` — Add `acp_supports_images(instance_id: String) -> Result<bool, String>` command
- `src-tauri/src/lib.rs` — Register the new command in `generate_handler![]`
- `src/lib/tauri.ts` — Add `acpSupportsImages(instanceId: string): Promise<boolean>` wrapper
- `src/lib/ai/vision.ts` — Wire `agent_managed` path to call the new command (or accept a pre-fetched boolean)

**Acceptance criteria:**

- Frontend can check `supportsVision()` for ACP connections
- Returns `false` if agent not initialized or capability not declared

---

## Task 8: Thread attachments through chat flow ✅

**Complexity:** M | **Category:** frontend | **Dependencies:** #1, #4, #5, #6

**Description:** Update the frontend chat flow so that `ImageAttachment[]` from `ChatInput` flows through to the Rust backend. This touches the `onSend` callback chain, message creation, store persistence, and the `invoke` calls.

**Files:**

- `src/components/chat/ChatInput.tsx` — Change `onSend` prop from `(message: string) => void` to `(message: string, attachments?: ImageAttachment[]) => void`
- `src/components/chat/ChatPanel.tsx` — Update `onSend` handler to pass attachments through
- `src/hooks/useDirectApiChat.ts` — Accept attachments in `sendChatMessage`, include on the user message object (line \~103), and pass `images` data in the `invoke('ai_chat_stream', ...)` call (line \~459). Map `ImageAttachment[]` to the `images` field format expected by Rust (`{ data, mime_type }`).
- `src/hooks/useAcpLifecycle.ts` — Update the three `invoke('acp_session_prompt', ...)` call sites (lines \~244, \~400, \~559) to pass images when attachments are present
- `src/lib/tauri.ts` — Update `acpSessionPrompt` wrapper to accept images parameter
- `src/stores/chat-store.ts` — Verify `attachments` persists via Zustand (optional field, no migration needed)

**Acceptance criteria:**

- Attachments flow from ChatInput → ChatPanel → useDirectApiChat/useAcpLifecycle → Rust backend
- Attachments stored on ChatMessage in chat-store (persisted)
- Old messages without attachments continue to work
- TypeScript compiles cleanly

---

## Task 9: Build attachment strip UI in ChatInput ✅

**Complexity:** L | **Category:** frontend | **Dependencies:** #1, #2, #3

**Description:** Add the image attachment UI to `ChatInput`: attachment button, thumbnail strip, paste handler, drag-drop handler, and file picker integration.

**Files:**

- `src/components/chat/ChatInput.tsx` — Major changes:
  - Add `pendingAttachments` state (`useState<ImageAttachment[]>([])`)
  - Add attachment button (lucide `ImagePlus`, 16px, strokeWidth 1.5) next to send button, conditionally rendered via `supportsVision()`
  - Add `AttachmentStrip` component (horizontal flex row of 48x48 thumbnails with remove buttons)
  - Add `onPaste` handler on textarea: check `clipboardData.files` for images, compress via `compressImage()`, add to pending
  - Add `onDragOver` / `onDrop` handlers on the input container: accept image files, compress, add to pending
  - File picker on attachment button click: use Tauri `dialog.open()` with image file filters
  - Max 5 images enforced with toast on overflow
  - Clear pending attachments after send
  - Pass attachments to `onSend(message, attachments)`
- `src/components/chat/AttachmentStrip.tsx` — New component: horizontal strip of thumbnails with hover-reveal X buttons. Props: `attachments: ImageAttachment[]`, `onRemove: (id: string) => void`.

**Acceptance criteria:**

- Paste image from clipboard → thumbnail appears in strip
- Drag image file → thumbnail appears in strip
- Click attachment button → file dialog opens, selected image compressed and shown
- X button on thumbnail removes it
- Max 5 images with toast
- Attachment button hidden when vision not supported
- Paste rejected with toast when vision not supported
- Strip clears after sending
- All styling per design system (CSS variables, dark mode, 150ms transitions)

---

## Task 10: Display image attachments in sent messages ✅

**Complexity:** M | **Category:** frontend | **Dependencies:** #1, #8

**Description:** Render inline image thumbnails on user messages that have attachments.

**Files:**

- `src/components/chat/ChatMessage.tsx` — In the `UserContent` function (line \~155), check `message.attachments`. If present, render a row of thumbnail images above the text content. Max-width 120px, rounded corners, clickable to expand.
- `src/styles/editor.css` or inline Tailwind — Thumbnail styles

**Acceptance criteria:**

- User messages with attachments show thumbnails above text
- Thumbnails are max 120px wide, rounded corners (`var(--radius)`)
- Clicking a thumbnail opens full-size view (modal or new window)
- Messages without attachments render unchanged
- Works in both light and dark mode

---

## Task 11: Ollama multimodal detection in Rust backend ✅

**Complexity:** M | **Category:** backend | **Dependencies:** None

**Description:** Extend the existing `detect_thinking_support()` pattern in `ai_streaming.rs` to also detect multimodal/vision capability from the Ollama `/api/show` response. Return this information alongside thinking support so the frontend can use it for vision gating.

**Files:**

- `src-tauri/src/commands/ai_streaming.rs` — Extend `ThinkingSupport` struct (or create a sibling `ModelCapabilities` struct) to include `is_multimodal: bool`. In `detect_thinking_support()` (line \~93), check the `/api/show` response for multimodal indicators (e.g., `"multimodal"` in model details/capabilities array, or vision-related model family names).
- `src-tauri/src/commands/ai.rs` — Add a new Tauri command `ollama_model_supports_vision(ollama_url: String, model: String) -> Result<bool, String>` that calls the detection logic. Register in `lib.rs`.
- `src/lib/tauri.ts` — Add wrapper `ollamaModelSupportsVision(ollamaUrl: string, model: string): Promise<boolean>`

**Acceptance criteria:**

- `/api/show` response parsed for multimodal capability
- New command returns `true` for known vision models (llava, SmolVLM, etc.)
- Returns `false` for text-only models
- Follows existing `detect_thinking_support` pattern (graceful fallback on error)

---

## Task 12: Handle vision model switching edge cases ✅

**Complexity:** S | **Category:** frontend | **Dependencies:** #3, #9

**Description:** Handle the edge case where a user has pending image attachments and switches to a non-vision provider/model.

**Files:**

- `src/components/chat/ChatInput.tsx` — Add an effect that watches the active connection/model. If `supportsVision()` becomes `false` while `pendingAttachments.length > 0`, clear attachments and show toast: "Images removed — current model doesn't support images".

**Acceptance criteria:**

- Switching from vision to non-vision model clears pending attachments
- Toast notification shown
- No crash or stale state
- Switching back to vision model allows new attachments

---

## Task 13: Editor "Send to AI" context menu for images and drawings ✅

**Complexity:** L | **Category:** frontend | **Dependencies:** #2, #3, #9

**Description:** Add a "Send to AI" context menu item on Image and Drawing nodes in the editor. Clicking it extracts the image, compresses it, opens the chat panel, and populates the pending attachments.

**Files:**

- `src/components/editor/EditorContent.tsx` or wherever the editor context menu is defined — Add "Send to AI" item for Image and Drawing node types. Guard with `supportsVision()` check.
- `src/components/chat/ChatInput.tsx` — Expose a way to externally add pending attachments (e.g., a ref callback, or a Zustand store for pending attachments, or a custom event)
- `src/lib/image-compress.ts` — Ensure it handles image URLs (local `asset://` protocol) and SVG strings (for drawings)

**For Image nodes:**

1. Get the `src` attribute (could be a local file path via Tauri asset protocol or a URL)
2. Fetch the image data (via Tauri `read_file` for local, or `fetch` for URLs)
3. Compress via `compressImage()`

**For Drawing nodes:**

1. Get the `data-drawing-id` attribute (path to `.excalidraw` file)
2. Resolve the `.svg` sidecar path (same path with `.svg` extension)
3. Load SVG content, render to canvas via `new Image()` with `src = 'data:image/svg+xml;...'`
4. Compress the rasterized PNG

**Acceptance criteria:**

- Right-click image → "Send to AI" visible (only when vision model active)
- Right-click drawing → "Send to AI" visible
- Clicking opens/focuses chat panel with image in attachment strip
- Image is compressed before attaching
- Drawings are rasterized from SVG and compressed
- Disabled/hidden when no vision-capable model is active

---

## Task 14: Write tests ✅

**Complexity:** L | **Category:** both | **Dependencies:** #1-#13

**Description:** Write unit and integration tests for the image attachment pipeline.

**Files:**

- `src/lib/__tests__/image-compress.test.ts` — New file:
  - Test: resizes image to max 1568px
  - Test: converts opaque PNG to JPEG
  - Test: preserves transparent PNG
  - Test: retries at lower quality when &gt;5 MB
  - Test: handles File, Blob, and base64 inputs
- `src/lib/ai/__tests__/vision.test.ts` — New file:
  - Test: `supportsVision` returns `true` for Anthropic
  - Test: `supportsVision` returns `true` for OpenAI
  - Test: `supportsVision` returns `false` for Ollama text model
  - Test: `supportsVision` returns `true` for local model with `supports_vision: true`
  - Test: `supportsVision` returns `false` for unknown provider
- `src-tauri/src/commands/ai.rs` — Add Rust tests:
  - Test: `ChatMessage` with images serializes correctly (serde round-trip)
  - Test: Anthropic message body includes image content blocks
  - Test: OpenAI message body includes image_url content blocks
  - Test: Ollama message body includes images array
- `src/stores/__tests__/chat-store.test.ts` — Add test case:
  - Test: Message with attachments round-trips through store (add → retrieve → verify attachments present)
  - Test: Old messages without attachments continue to work

**Acceptance criteria:**

- All new tests pass (`pnpm test`, `cargo test`)
- Compression pipeline has coverage for core paths
- Vision detection has coverage for each provider type
- Rust serialization tested per provider
- No regressions in existing tests