# Research: Image Attachments for Multi-Modal AI Chat

**Date:** 2026-04-03 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [image-attachments](../prds/2026-04-04-image-attachments.md) | Draft |
| Tasks | --- | Not planned |

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

The ACP spec defines a `ContentBlock` enum with five variants (reuses MCP's structure):

```
ContentBlock::Text(TextContent)          -- always supported (baseline)
ContentBlock::Image(ImageContent)        -- requires `image` prompt capability
ContentBlock::Audio(AudioContent)        -- requires `audio` prompt capability
ContentBlock::Resource(EmbeddedResource) -- requires `embeddedContext` prompt capability
ContentBlock::ResourceLink(ResourceLink) -- always supported (baseline)
```

`ImageContent` uses base64 inline (not file references or URLs):

```rust
pub struct ImageContent {
    pub annotations: Option<Annotations>,
    pub data: Base64Bytes,       // base64-encoded image data
    pub mime_type: String,       // e.g. "image/png", "image/jpeg"
    pub type_: String,           // discriminator, always "image"
}
```

JSON wire format:

```json
{
  "type": "image",
  "mimeType": "image/png",
  "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..."
}
```

**Capability negotiation:** During `initialize`, agents declare supported content types:

```json
{
  "promptCapabilities": {
    "image": true,
    "audio": true,
    "embeddedContext": true
  }
}
```

Clients MUST check these before including non-text content blocks.

**Per-agent support status:**

| Agent | Image support? | Notes |
|---|---|---|
| `claude-agent-acp` | Yes | Claude models are vision-capable; changelog mentions "fix for image output from tool calls" |
| `codex-acp` | Yes | Codex CLI supports `--image` flag; uses vision-enabled models |
| `copilot --acp` | Yes | ACP server explicitly supports "prompts with text, images, and context resources" |
| `gemini --acp` | Yes | Initialize response confirms `promptCapabilities: { image: true, audio: true, embeddedContext: true }` |

**Current gap in Notesage:** `acp_session_prompt` in `src-tauri/src/commands/acp.rs` only sends `ContentBlock::Text`:

```rust
// line ~637
vec![ContentBlock::Text(TextContent::new(content))],
```

The command takes a plain `content: String`. The `promptCapabilities` from the initialize response are not inspected or stored. The Rust crate already in use (`agent-client-protocol = 0.10.4`, `agent-client-protocol-schema = 0.11.4`) includes `ImageContent` and the full `ContentBlock` enum — no dependency changes needed.

**To send images via ACP:**

```rust
let blocks = vec![
    ContentBlock::Text(TextContent::new(text)),
    ContentBlock::Image(ImageContent::new(base64_data, "image/png")),
];
let req = PromptRequest::new(SessionId::new(sid), blocks);
```

Sources: [ACP Content Docs](https://agentclientprotocol.com/protocol/content), [ACP Initialization](https://agentclientprotocol.com/protocol/initialization), [ContentBlock enum on docs.rs](https://docs.rs/agent-client-protocol/latest/agent_client_protocol/enum.ContentBlock.html), [Copilot CLI ACP docs](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server), [Gemini CLI ACP mode](https://geminicli.com/docs/cli/acp-mode/)

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

### Per-Tool Breakdown

**Cursor IDE:**
- Input: Drag-drop (since v0.17.0), Ctrl+V paste in chat (not in Composer), file picker (inconsistent — [issue #2776](https://github.com/cursor/cursor/issues/2776))
- Display: Originally inline thumbnails, switched to compact file tag chips in v0.40+
- Non-vision: Explicit error "Trying to submit images without a vision-enabled model selected" — blocks send. Error persists in session even after switching models; must start new chat.
- No client-side resize — users hit "Image base64 size exceeds API limit (5.0 MB)" and must manually resize
- Images can get "stuck" in session state and re-sent with every subsequent API call

**Continue.dev:**
- Input: Cmd/Ctrl+V paste, Shift+drag-drop ([PR #7408](https://github.com/continuedev/continue/pull/7408) fixed overlay bug)
- Display: Inline thumbnails in chat input
- Non-vision: `image_input` capability auto-detected per provider/model in `core/llm/autodetect.ts` (`PROVIDER_SUPPORTS_IMAGES` array). UI disables attachment for non-vision models. Users can manually override in `config.yaml`.
- No client-side compression

**Cline (Claude Dev):**
- Input: Cmd/Ctrl+V paste, Shift+drag-drop, "Add Files & Images" button. Known issues on Linux Wayland ([#5016](https://github.com/cline/cline/issues/5016)) and SSH remotes ([#7606](https://github.com/cline/cline/issues/7606)). File dialog filter missing image extensions in v3.38.3 ([#7743](https://github.com/cline/cline/issues/7743)).
- Display: Inline thumbnails before and after sending
- Non-vision: `supportsImages` flag on model config gates UI. PRs [#8684](https://github.com/cline/cline/pull/8684) and [#9780](https://github.com/cline/cline/pull/9780) fixed bugs where paste/drag-drop bypassed the toggle.
- No client-side resize; [issue #675](https://github.com/cline/cline/issues/675) requested 2000px dimension cap

**Windsurf (Codeium):**
- Input: Drag-drop from OS (not from Windsurf's own explorer), clipboard paste, "Add image" button
- Display: Inline previews; positioned for "Image-to-Code" workflows (Figma screenshot → HTML/CSS)
- Non-vision: Only available for GPT-4o and Claude 3.5 Sonnet. API error breaks session history with non-vision models.
- Originally 1 MB limit (now lifted)

**Claude Desktop & Claude Code:**
- Input: Paperclip button, drag-drop, Cmd+V paste. Claude Code uses Ctrl+V (not Cmd+V on macOS — known UX issue)
- Display: Inline thumbnail previews, expandable
- Size: 5 MB API limit / 30 MB on claude.ai. Server-side downscale if >1568px longest edge. Claude Code does NOT auto-resize ([feature request #20738](https://github.com/anthropics/claude-code/issues/20738))
- Token cost: `(width * height) / 750` — ~1,600 tokens for typical image

**ChatGPT Desktop:**
- Input: + button menu → "Upload file", drag-drop (broken on Windows 11), Cmd/Ctrl+V paste, **built-in screenshot tool** (unique — shows open windows, searchable), webcam capture
- Display: Inline thumbnails, clickable to expand
- Size: 20 MB per image. Free tier: 2 images/day; Plus: 50/day
- Server-side `detail` processing: `low` = 512x512 at 85 tokens, `high` = 768px shortest side then 512x512 tiles

### Summary Comparison Table

| Feature | Cursor | Continue.dev | Cline | Windsurf | Claude Desktop | ChatGPT Desktop |
|---|---|---|---|---|---|---|
| **Paste** | Ctrl+V in chat only | Cmd/Ctrl+V | Cmd/Ctrl+V | Yes | Yes | Yes |
| **Drag-drop** | Yes | Shift+drag | Shift+drag | OS only | Yes | Yes (broken Win11) |
| **File picker** | Inconsistent | Not prominent | "Add Files & Images" | "Add image" button | Paperclip | + button menu |
| **Screenshot** | No (3rd-party ext) | No | No | No | No | **Built-in tool** |
| **Preview display** | File tag chip (v0.40+) | Inline thumbnail | Inline thumbnail | Inline preview | Inline thumbnail | Inline thumbnail |
| **Non-vision handling** | Error, blocks send | UI disables attach | `supportsImages` gates UI | API error, breaks session | N/A (all support) | Model-gated |
| **Client-side resize** | No | No | No | No | No | No |
| **Size limit** | Provider-dependent | Provider-dependent | Provider-dependent | Was 1MB, now lifted | 5MB API / 30MB web | 20MB |

### Key Patterns

**Input methods:** Clipboard paste is universal and highest priority. Drag-drop second. File picker as fallback.

**Display:** Inline thumbnails (before and after sending) is the standard. Cursor's v0.40 switch to compact file chips is the outlier.

**Non-vision models:** The consensus is to **gate the attachment UI on model vision capability**. Tools that allow attaching images to non-vision models create broken session state. Best practice: hide/disable the button and reject pastes with a toast.

**Client-side compression:** **No tool does it today** — but it's the #1 requested feature across Cursor, Cline, and Claude Code. This is a clear opportunity: pre-resize to 1568px longest edge + JPEG 80% would prevent the most common user error (5 MB API limit).

**Recommendation:** Resize to 1568px longest edge + JPEG 80% quality before base64 encoding. This satisfies Anthropic's 5 MB limit (the most restrictive) while preserving visual quality. Notesage would be the first tool to do client-side compression automatically.

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
