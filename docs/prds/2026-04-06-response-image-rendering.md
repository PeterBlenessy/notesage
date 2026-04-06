# PRD: Response Image Rendering

|  |  |
| --- | --- |
| **Date** | 2026-04-06 |
| **Status** | Implemented |
| **Priority** | High |
| **Impact** | Users can see images returned by AI agents and providers in chat messages |

## Problem

Notesage supports sending images to AI providers (vision), but cannot display images returned in AI responses. ACP agents like Claude Code can return screenshots, diagrams, and generated images as `ContentBlock::Image` in their responses. Anthropic's direct API can return images in content blocks. OpenAI can return generated images via DALL-E tool calls. All of these are silently dropped today, leaving users with incomplete or confusing responses.

## Goals / Non-Goals

**Goals:**

1. Display images returned by ACP agents in chat messages (P0)
2. Display images returned by Anthropic direct API in chat messages (P1)
3. Display images returned by OpenAI direct API in chat messages (P2)
4. Images are clickable for full-size preview
5. Images are included in conversation export (Markdown as data URIs, JSON as base64)

**Non-Goals:**

- Image generation UI (DALL-E prompt builder, image editing)
- Saving response images to disk automatically
- Ollama / local bundled image responses (text-only output)
- Image-to-image workflows
- Thumbnail gallery or image management

## User Stories

- As a user chatting with Claude Code, I want to see screenshots the agent takes during computer use, so I can follow along with what it's doing.
- As a user chatting with an Anthropic model, I want to see any images included in the response, so I get the complete answer.
- As a user chatting with OpenAI, I want to see DALL-E generated images inline in the chat, so I don't need to open a separate tool.
- As a user, I want to click on a response image to see it full-size, so I can examine details.
- As a user exporting a conversation, I want response images included in the export, so the export is complete.

## Technical Approach

### New Segment Type

Add an `ImageSegment` to the existing chronological segment system:

```typescript
export interface ImageSegment extends MessageSegmentBase {
  type: 'image';
  data: string;       // base64-encoded image data
  mimeType: string;   // e.g. "image/png", "image/jpeg"
  alt?: string;       // optional alt text / description
}
```

Update the `Segment` union type:

```typescript
export type Segment = TextSegment | ThinkingSegment | ToolCallSegment | ToolResultSegment | ImageSegment;
```

### P0: ACP Agents

The ACP protocol already delivers `ContentBlock::Image` via `agent_message_chunk` session updates. The Rust backend (`acp_client.rs`) forwards the raw update JSON to the frontend via `acp-session-update` events.

**Changes needed:**

1. **`useAcpSessionListeners.ts`** — Handle `update.content?.type === 'image'` in the `agent_message_chunk` branch. Extract `update.content.data` (base64) and `update.content.mimeType`. Push an `ImageSegment` to the message.

2. **`chat-store.ts`** — No new actions needed. The existing `pushSegment` action works for any segment type.

3. **`ChatMessage.tsx`** — Add `ImageSegmentView` to the `SegmentRenderer` switch. Render as an `<img>` tag with `src="data:{mimeType};base64,{data}"`.

4. **`segments/ImageSegmentView.tsx`** — New component. Renders the image with max-width constraint, rounded corners, and click-to-preview (reuse the existing image preview pattern from `AttachmentStrip`).

### P1: Anthropic Direct API

Anthropic's Messages API can return `content_block_start` with `type: "image"` containing base64 data. Currently `ai_streaming.rs` only handles `type: "text"`, `type: "tool_use"`, and `type: "thinking"`.

**Changes needed:**

1. **`ai_streaming.rs`** — In the `content_block_start` handler, detect `type: "image"` blocks. Emit a new `ai-stream-image` Tauri event with `{ data: string, mimeType: string }`.

2. **`useDirectApiChat.ts`** — Listen for `ai-stream-image` events. Push an `ImageSegment` to the assistant message.

### P2: OpenAI Direct API

OpenAI returns images via DALL-E tool calls. The tool result contains a URL or base64 data. Since tool calling already works, the image URL appears in tool results but isn't rendered as an image.

**Changes needed:**

1. **`tool-executor.ts`** — Detect image URLs in DALL-E tool results. Fetch the image and convert to base64 if it's a URL.

2. **`useDirectApiChat.ts`** — When a tool result contains image data (detected by MIME type or DALL-E tool name), push an `ImageSegment` in addition to the `ToolResultSegment`.

Alternative: OpenAI's newer models (gpt-4o) can return images directly in content blocks (similar to Anthropic). If using the Chat Completions API, handle `type: "image_url"` in response content.

## UI/UX

### Image Segment View

- Max width: 100% of chat bubble, max height: 400px, `object-contain`
- Rounded corners (`rounded-md`), subtle border (`border border-border`)
- Click opens full-size preview in a modal/overlay (centered, backdrop blur, Escape to close)
- Images appear inline in the chronological segment stream, between text and tool calls
- Loading state: skeleton placeholder while base64 decodes (likely instant)

### Full-Size Preview

- Reuse or adapt the pattern from `AttachmentStrip` image preview if one exists
- Centered overlay with `max-w-[90vw] max-h-[90vh]`
- Click backdrop or press Escape to dismiss
- No download button needed (out of scope)

### Conversation Export

- **Markdown export:** Render as `![image](data:image/png;base64,...)` inline
- **JSON export:** Include `ImageSegment` in the segments array as-is (base64 data preserved)

## Data Model

### New Type

```typescript
// In src/lib/ai/types.ts
export interface ImageSegment extends MessageSegmentBase {
  type: 'image';
  data: string;       // base64
  mimeType: string;   // "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  alt?: string;
}

// Updated union
export type Segment = TextSegment | ThinkingSegment | ToolCallSegment | ToolResultSegment | ImageSegment;
```

### New Tauri Event (P1)

```rust
// Emitted from ai_streaming.rs for Anthropic image content blocks
"ai-stream-image" => { data: String, mimeType: String }
```

### ACP Update Shape (already exists, just not handled)

```typescript
// update.content when type is "image":
{
  type: "image",
  data: string,      // base64
  mimeType: string,  // e.g. "image/png"
}
```

## Dependencies

- No new libraries needed
- Relies on existing segment infrastructure (`chat-store`, `SegmentRenderer`)
- ACP crate already delivers image content blocks

## Quality Gates

### Functional

- [x] ACP agent image responses display inline in chat messages
- [x] Anthropic API image responses display inline in chat messages
- [x] OpenAI image responses (DALL-E or content blocks) display inline
- [x] Clicking an image opens full-size preview
- [x] Escape closes the preview
- [x] Images appear in correct chronological position among other segments
- [x] Messages without image segments render unchanged (backward compat)
- [x] Markdown export includes response images as data URIs
- [x] JSON export includes ImageSegment with base64 data

### Design

- [x] Images have rounded corners and border consistent with chat bubble style
- [x] Full-size preview has backdrop blur and smooth animation
- [x] Images scale appropriately (never overflow the chat panel)
- [x] Works in both light and dark mode

### Testing

- [x] Unit test: `ImageSegment` pushed to store and retrievable
- [x] Unit test: `SegmentRenderer` renders `ImageSegmentView` for image segments
- [x] Unit test: Export includes image segments in output

## Out of Scope

- Image generation UI or DALL-E prompt interface
- Auto-saving response images to project files
- Image editing or annotation
- Ollama / local bundled model image responses
- Right-click "Save image as..." on response images (future enhancement)
- Image compression for response images (they come pre-sized from the provider)
