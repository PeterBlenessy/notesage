# Response Image Rendering — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-06 |
| **Status** | Complete |
| **PRD** | [response-image-rendering](../prds/2026-04-06-response-image-rendering.md) |
| **Total** | 9 tasks: 4S, 4M, 1L |
| **Suggested order** | Types (#1) → UI (#2-#3) → ACP (#4) → Anthropic (#5-#6) → OpenAI (#7) → Export (#8) → Tests (#9) |

**Risks:**
- ACP `ContentBlock::Image` field names (`data`, `mimeType`) need to be verified against the actual crate — the field names in the JSON payload may differ from the PRD assumptions.
- Anthropic image content blocks are relatively new — verify the SSE event shape with a real API call.
- Large base64 images in localStorage (via Zustand persist) could bloat storage. Consider whether image segments should be excluded from persistence or capped.

---

### #1 — Add ImageSegment type to segment system ✅

**Description:** Add `ImageSegment` interface to `src/lib/ai/types.ts` and include it in the `Segment` union type. Update `MessageSegmentBase.type` to include `'image'`. Add `'image'` to `segmentOps.ts` if any type guards exist there.

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:**
- `src/lib/ai/types.ts` — add `ImageSegment` interface, update `Segment` union and `MessageSegmentBase.type`

---

### #2 — Create ImageSegmentView component ✅

**Description:** New component in `src/components/chat/segments/ImageSegmentView.tsx`. Renders a base64 image as `<img src="data:{mimeType};base64,{data}">`. Max width 100% of bubble, max height 400px, `object-contain`. Styled with `rounded-md border border-border`. Click opens a full-size preview overlay.

**Acceptance criteria:**
- Image renders inline in segment stream
- Click opens full-size overlay (centered, backdrop blur, max 90vw/90vh)
- Escape or backdrop click closes overlay
- Works in light and dark mode

**Complexity:** M
**Category:** frontend
**Dependencies:** #1
**Files:**
- `src/components/chat/segments/ImageSegmentView.tsx` — new component
- `src/components/chat/segments/index.ts` — export the new view

---

### #3 — Wire ImageSegmentView into SegmentRenderer ✅

**Description:** Add a `case 'image'` branch to the `SegmentRenderer` switch in `ChatMessage.tsx`. Import and render `ImageSegmentView`. Also add the `'image'` case to `groupSegments` if image segments should not be grouped with tool calls (they should render standalone like text segments).

**Complexity:** S
**Category:** frontend
**Dependencies:** #2
**Files:**
- `src/components/chat/ChatMessage.tsx` — add case to `SegmentRenderer`, import `ImageSegmentView`

---

### #4 — Handle ACP image content blocks (P0) ✅

**Description:** In `useAcpSessionListeners.ts`, the `agent_message_chunk` handler currently only processes `update.content?.type === 'text'`. Add a branch for `update.content?.type === 'image'` that extracts `data` and `mimeType` from the content and pushes an `ImageSegment` via `deps.pushSegment`. Update `AcpSessionUpdate` interface in `acp-utils.ts` to type the image content shape (`content?: { type: string; text?: string; data?: string; mimeType?: string }`).

**Acceptance criteria:**
- ACP agent returning an image shows it inline in the chat message
- Image appears in correct chronological position among text and tool call segments
- Non-image messages unaffected

**Complexity:** M
**Category:** frontend
**Dependencies:** #1, #3
**Files:**
- `src/hooks/useAcpSessionListeners.ts` — add image content handling
- `src/lib/ai/acp-utils.ts` — extend `AcpSessionUpdate.content` type with `data?` and `mimeType?`

---

### #5 — Emit ai-stream-image from Anthropic streaming (P1) ✅

**Description:** In `ai_streaming.rs`, the `content_block_start` handler detects block types. Add handling for `type: "image"` blocks — extract `source.data` (base64) and `source.media_type`, emit a new `ai-stream-image` Tauri event with `{ data, mimeType }`. Follow the pattern used by `ai-stream-chunk` and `ai-stream-thinking-chunk`.

**Acceptance criteria:**
- When Anthropic API returns an image content block, `ai-stream-image` event is emitted
- Non-image content blocks unaffected
- Event payload contains base64 data and MIME type

**Complexity:** M
**Category:** backend
**Dependencies:** None
**Files:**
- `src-tauri/src/commands/ai_streaming.rs` — handle `"image"` in `content_block_start`, emit event

---

### #6 — Listen for ai-stream-image in direct API chat (P1) ✅

**Description:** In `useDirectApiChat.ts`, register a listener for the `ai-stream-image` Tauri event. When received, push an `ImageSegment` to the current assistant message via `pushSegment`. Follow the same pattern as `ai-stream-chunk` and `ai-stream-thinking-chunk` listeners.

**Complexity:** S
**Category:** frontend
**Dependencies:** #1, #3, #5
**Files:**
- `src/hooks/useDirectApiChat.ts` — add `ai-stream-image` listener, push `ImageSegment`

---

### #7 — Handle OpenAI image responses (P2) ✅

**Description:** OpenAI can return images via DALL-E tool calls (URL in tool result) or as content blocks in newer Chat Completions responses. Two approaches:

1. In `ai_streaming.rs`, check OpenAI streamed response chunks for image content (if the response format includes `type: "image_url"` in message content).
2. In `tool-executor.ts`, when a DALL-E tool result contains an image URL, fetch it via Tauri HTTP, convert to base64, and push an `ImageSegment`.

Start with approach 1 (content blocks) as it's more general. Fall back to approach 2 for DALL-E specific flows if needed.

**Complexity:** L
**Category:** both
**Dependencies:** #1, #3, #6
**Files:**
- `src-tauri/src/commands/ai_streaming.rs` — handle OpenAI image content in streaming
- `src/hooks/useDirectApiChat.ts` — handle OpenAI image events (may reuse `ai-stream-image`)
- `src/lib/tool-executor.ts` — optional: detect image URLs in DALL-E tool results

---

### #8 — Include images in conversation export ✅

**Description:** Update `formatMessagesAsMarkdown` in `ChatHistoryView.tsx` to handle the `'image'` segment type. Render as `![image](data:{mimeType};base64,{data})` for Markdown export. JSON export already includes the full segments array, so it works without changes — just verify.

**Complexity:** S
**Category:** frontend
**Dependencies:** #1
**Files:**
- `src/components/chat/ChatHistoryView.tsx` — add `case 'image'` to `formatMessagesAsMarkdown`

---

### #9 — Write tests ✅

**Description:** Add unit tests covering:
- `ImageSegment` can be pushed to chat store and retrieved in messages
- `SegmentRenderer` renders `ImageSegmentView` when segments include an image
- `formatMessagesAsMarkdown` outputs image markdown for image segments
- ACP listener pushes image segment for image content type (mock test)

**Complexity:** M
**Category:** frontend
**Dependencies:** #1, #2, #3, #4, #8
**Files:**
- `src/stores/__tests__/chat-store-image-segment.test.ts` — new test file
- `src/components/chat/__tests__/ImageSegmentView.test.tsx` — new test file
- `src/components/chat/__tests__/ChatHistoryView.test.tsx` — add image export test (or new file)
