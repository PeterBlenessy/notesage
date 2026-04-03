# Research: Image Attachments for Multi-Modal AI Chat

**Date:** 2026-04-03
**Status:** Research complete
**Purpose:** Understand how image attachments should work across Notesage's four AI paths (Direct API, ACP, Copilot LSP, Local Bundled) by surveying API formats, competitor UX, and implementation patterns.

---

## 1. API Message Formats by Provider

Each provider uses a different wire format for images in chat messages. Notesage must serialize images differently per provider.

### Anthropic (Claude)

Content array with `type: "image"` blocks. Three source types:

```json
// Base64 (most common for desktop apps)
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/jpeg",
    "data": "<base64-encoded-string>"
  }
}

// URL (for publicly accessible images)
{
  "type": "image",
  "source": {
    "type": "url",
    "url": "https://example.com/image.jpg"
  }
}

// Files API (upload once, reference by ID — avoids re-sending on every turn)
{
  "type": "image",
  "source": {
    "type": "file",
    "file_id": "file_abc123"
  }
}
```

**Constraints:**
- Formats: JPEG, PNG, GIF, WebP
- Max 5 MB per image (API), 10 MB (claude.ai)
- Max 8000x8000 px (single), 2000x2000 px (when >20 images)
- Up to 600 images per request (100 for 200k-token models)
- 32 MB total request size limit
- Server-side resize if long edge >1568 px
- Token cost: `(width * height) / 750`
- Images should be placed **before** text in the content array for best results
- Base64 images re-sent every turn in multi-turn conversations (Files API avoids this)

### OpenAI (GPT-4o)

Content array with `type: "image_url"` blocks. Base64 encoded as data URIs:

```json
// URL
{
  "type": "image_url",
  "image_url": {
    "url": "https://example.com/image.jpg",
    "detail": "high"
  }
}

// Base64 (embedded as data URI)
{
  "type": "image_url",
  "image_url": {
    "url": "data:image/jpeg;base64,<base64-encoded-string>",
    "detail": "auto"
  }
}
```

**Constraints:**
- Formats: JPEG, PNG, GIF, WebP
- `detail` parameter: `"low"` (fixed 85 tokens), `"high"` (variable by tile count), `"auto"` (model decides)
- Low detail: resized to 512x512
- High detail: scaled so shortest side = 768px, split into 512x512 tiles; cost = 85 + (170 * tiles) tokens
- Max 20 MB per image

### Ollama

**Native `/api/chat`** — `images` array on the message itself (not in a content array):

```json
{
  "role": "user",
  "content": "Describe this image",
  "images": ["<base64-encoded-string>"]
}
```

**OpenAI-compatible `/v1/chat/completions`** — also accepts the OpenAI `image_url` format with data URIs.

**Constraints:**
- Base64-only (no URL support in native REST API)
- Formats: JPEG, PNG, WebP
- Requires multimodal model (llava, SmolVLM, etc.)

### llama-server (Local Bundled)

OpenAI-compatible `image_url` format via `/v1/chat/completions`:

```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "describe what you see"},
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/png;base64,<base64>"
      }
    }
  ]
}
```

**Constraints:**
- Supports base64 data URIs and remote URLs
- Multimodal is "experimental" — requires vision projector (`--mmproj` or auto-detected via `-hf`)
- Supported families: Gemma 3, Qwen 2/2.5 VL, SmolVLM, Pixtral, InternVL, Llama 4 Scout, Moondream2
- Same wire format as OpenAI — serialization code can be shared

### ACP (Agent Client Protocol)

First-class `ImageContent` content block:

```json
{
  "type": "image",
  "data": "<base64-encoded-string>",
  "mimeType": "image/png",
  "uri": "optional-reference-uri",
  "annotations": {}
}
```

**Key details:**
- Agents advertise image support via `promptCapabilities.image: true` during initialization
- Also supports `AudioContent` (`type: "audio"`) and `ResourceLink` / `EmbeddedResource`
- Content blocks are ordered — images can be interleaved with text

### Format Summary Table

| Provider | Content Type | Base64 Format | URL Support | Image Location |
|---|---|---|---|---|
| Anthropic | `"type": "image"` | `source.data` | `source.url` | `content[]` array |
| OpenAI | `"type": "image_url"` | data URI in `image_url.url` | direct URL | `content[]` array |
| Ollama (native) | N/A | `images: [base64]` | No | Message object |
| Ollama (OAI compat) | `"type": "image_url"` | Same as OpenAI | Same as OpenAI | `content[]` array |
| llama-server | `"type": "image_url"` | Same as OpenAI | Same as OpenAI | `content[]` array |
| ACP | `"type": "image"` | `data` + `mimeType` | `uri` optional | Prompt content blocks |

---

## 2. Chat UI Patterns from Competitor Tools

### Input Methods

| Method | Tools |
|--------|-------|
| **Clipboard paste** (Cmd/Ctrl+V) | Claude desktop, ChatGPT, Copilot Chat, Cline, Cursor, Windsurf |
| **Drag and drop** from OS | Claude desktop, ChatGPT, Copilot Chat, Cursor, Windsurf |
| **File picker button** (paperclip icon) | Claude desktop, ChatGPT, all IDE tools |
| **Screenshot capture** (built-in) | Copilot Chat in VS Code ("Attach > Screenshot Window") |

**Clipboard paste is the most common interaction** — every tool supports it. Drag-and-drop is second. File picker is always available as a fallback. Screenshot capture is rare (only VS Code Copilot).

### Display Patterns

- **Before sending:** Small thumbnail appears in/near the chat input area. Click to enlarge or remove (X button on thumbnail).
- **After sending:** Image displays inline within the user message bubble at a readable preview size.
- **Non-image files:** Shown as a filename chip/badge rather than a preview (Cursor pattern).

### Provider Incompatibility Handling

This is a critical UX question — what happens when the selected model doesn't support images?

| Tool | Approach |
|------|----------|
| **Cline** | Only shows image option for multimodal models (GPT-4o, Claude, Gemini). Silently hidden otherwise. |
| **Continue.dev** | Model capabilities in config with `image_input` flag. Non-vision models don't get attachment UI. |
| **Copilot Chat** | Image attachment gated behind GPT-4o model selection. |
| **Common pattern** | **Conditionally show/hide the attachment button** based on active model's vision capability. |

**Consensus:** Hide/disable the attachment UI for non-vision models. Don't let users attach images they can't send.

### Size Limits & Compression

| Aspect | Common Practice |
|--------|----------------|
| **Client-side compression** | `canvas.toDataURL('image/jpeg', 0.8)` — JPEG at 80% quality |
| **Resolution downsizing** | Max 1568px on longest edge (Anthropic's optimal) or 2048px |
| **Provider limits** | Anthropic: 5 MB; OpenAI: 20 MB |
| **Image count** | VS Code Copilot limits to 3 images per prompt |
| **Auto-compress** | Claude Code auto-compresses images over 5 MB |

**Recommendation:** Resize to 1568px longest edge + JPEG 80% quality before base64 encoding. This satisfies Anthropic's 5 MB limit (the most restrictive) while preserving visual quality.

---

## 3. Editor-to-Chat Image Flow

**No tool currently has a "click image in document, send to AI" flow.** The universal pattern is always:

1. User manually copies/screenshots/drags the image
2. Pastes/drops into chat input
3. Thumbnail preview shown
4. On send, base64-encoded in API request

### Existing approaches

- **Windsurf:** Users paste screenshots of their website/UI into Cascade chat for code generation. Always manual.
- **Copilot Chat "Screenshot Window":** Captures the VS Code window contents as an attachment. Closest to editor-to-chat.
- **Cursor:** Drag files from explorer into chat. No "send image from document" action.
- **Claude Code Desktop:** Attachment button, drag-and-drop, clipboard paste.

### Differentiation opportunity for Notesage

Notesage already has images and drawings embedded in documents (Image extension, Excalidraw Drawing extension). A unique feature would be:

- Right-click image in editor -> "Send to AI" / "Ask AI about this image"
- Bubble menu on image selection with AI actions
- Auto-include document images as context when user references them in chat

---

## 4. Key Architecture Decisions

### A. Capability Detection Layer

Each AI path needs vision capability checking:

| Path | How to detect vision support |
|------|------------------------------|
| **Direct API (Anthropic/OpenAI)** | Always supported (Claude 3+, GPT-4o+). Could be model-gated. |
| **Direct API (Ollama)** | Query `/api/show` for multimodal tag (similar to existing thinking detection) |
| **ACP** | Check `promptCapabilities.image` from agent initialization |
| **Local bundled** | Check `supports_vision` flag in `model-catalog.json` |
| **Copilot LSP** | Not applicable (completions only, no chat) |

### B. Internal Image Representation

Store images internally in a provider-agnostic format, then serialize per-provider at send time:

```typescript
interface ImageAttachment {
  data: string;       // base64-encoded
  mimeType: string;   // "image/jpeg" | "image/png" | "image/gif" | "image/webp"
  width?: number;     // original width (for display)
  height?: number;    // original height (for display)
  name?: string;      // optional filename
}
```

Provider serializers convert this to the appropriate wire format:
- **Anthropic** -> `{ type: "image", source: { type: "base64", media_type, data } }`
- **OpenAI** -> `{ type: "image_url", image_url: { url: "data:${mime};base64,${data}" } }`
- **Ollama native** -> `images: [data]` on the message object
- **ACP** -> `{ type: "image", data, mimeType }`

### C. ChatMessage Model Change

Currently `ChatMessage.content` is a `string`. Options:

1. **New `attachments` field** (recommended — simpler, backward compatible):
   ```typescript
   interface ChatMessage {
     role: string;
     content: string;
     attachments?: ImageAttachment[];  // NEW
     // ... existing fields
   }
   ```
   Provider serializers merge `content` + `attachments` into the provider-specific content array format at send time. Zustand persist handles it naturally. Old messages without `attachments` work unchanged.

2. **Change `content` to union type** (matches API shape but invasive):
   ```typescript
   content: string | ContentBlock[];
   ```
   Requires updating every place that reads `content` as a string. High risk, low reward.

**Pattern from Cline/Continue:** They use a separate `images` or `attachments` array alongside text content, and the provider serializer merges them. This is the recommended approach.

### D. Image Compression Pipeline

Before base64 encoding, process images client-side:

1. Load into an `HTMLCanvasElement` or `OffscreenCanvas`
2. If PNG with no transparency needed, convert to JPEG
3. Resize so longest edge <= 1568px (Anthropic's optimal; anything larger is resized server-side anyway)
4. Export as JPEG at 80% quality (or keep PNG if transparency is needed)
5. Validate resulting base64 is < 5 MB (Anthropic's limit, the most restrictive)
6. If still too large, reduce quality to 60% and retry

This can be done entirely in the frontend with `canvas.toBlob()` / `canvas.toDataURL()`.

### E. Rust Backend Changes

The `ai_chat_stream` Tauri command currently takes `messages: Vec<ChatMessage>` where `ChatMessage.content` is a `String`. To support images:

- Add `images: Option<Vec<ImageData>>` field to `ChatMessage` struct in `ai.rs`
- Each provider's request builder merges text + images into the correct format
- For ACP: images passed as `ImageContent` blocks in the prompt
- For Ollama native: images placed in the `images` array on the JSON message

```rust
#[derive(Serialize, Deserialize)]
pub struct ImageData {
    pub data: String,      // base64
    pub mime_type: String,  // "image/jpeg", etc.
}
```

### F. Recommended Input Methods (priority order)

1. **Clipboard paste** into chat input (Cmd+V) — highest ROI, most used pattern
2. **Drag and drop** onto chat input area
3. **Paperclip/attachment button** with native file picker dialog
4. **Right-click image in editor -> "Ask AI"** — Notesage differentiator
5. **Screenshot capture** — future enhancement

### G. UI When Model Doesn't Support Images

- **Hide/disable** the attachment button and paste handler when active model lacks vision
- If user switches from a vision model to non-vision with pending attachments, show toast: "Images removed — current model doesn't support images"
- Attachment button tooltip: "Attach image (requires vision model)"

---

## 5. Multi-Turn Image Handling

A critical cost consideration: **base64 images are re-sent on every API turn** in multi-turn conversations.

### The problem

A 1568x1568 JPEG at 80% quality is ~200-400 KB base64. In a 10-turn conversation with 2 images, that's 4-8 MB re-sent per turn. This is:
- Expensive (token cost: ~3,280 tokens per 1568x1568 image on Anthropic)
- Slow (large request payloads)

### How others handle it

- **Anthropic Files API:** Upload once, reference by `file_id`. Avoids re-sending. Not yet widely adopted by third-party tools.
- **Claude Code:** Currently re-sends images every turn (known pain point, issue #20738).
- **ChatGPT:** Re-sends images every turn (standard behavior).
- **Most tools:** Accept the cost and re-send.

### Recommendation for Notesage

- **Phase 1:** Re-send images on every turn (matches industry standard, simpler to implement)
- **Phase 2:** Consider Anthropic Files API for heavy image use cases
- **Optimization:** Only include images from the turn they were attached (don't carry forward to subsequent turns unless the user explicitly re-attaches)

---

## 6. Sources

- [Anthropic Vision API](https://docs.anthropic.com/en/docs/build-with-claude/vision)
- [OpenAI Vision API](https://platform.openai.com/docs/guides/vision)
- [Ollama API Reference](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [llama.cpp Multimodal Docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md)
- [llama.cpp Server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [Agent Client Protocol GitHub](https://github.com/agentclientprotocol/agent-client-protocol)
- [ACP Intro (Goose)](https://block.github.io/goose/blog/2025/10/24/intro-to-agent-client-protocol-acp/)
- [ACP Docs (Kiro)](https://kiro.dev/docs/cli/acp/)
- [Copilot Chat Vision (VS Code)](https://github.blog/changelog/2025-03-05-copilot-chat-users-can-now-use-the-vision-input-in-vs-code-and-visual-studio-public-preview/)
- [Cline Image Support](https://github.com/cline/cline/issues/7743)
- [Continue.dev Model Capabilities](https://docs.continue.dev/customize/deep-dives/model-capabilities)
- [Claude Code Image Guide](https://smartscope.blog/en/generative-ai/claude/claude-code-image-guide/)
- [llama.cpp Vision (Simon Willison)](https://simonwillison.net/2025/May/10/llama-cpp-vision/)
- [Windsurf vs Cursor](https://www.builder.io/blog/windsurf-vs-cursor)
