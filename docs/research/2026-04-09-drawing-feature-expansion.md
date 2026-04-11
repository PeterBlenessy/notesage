# Drawing Feature Expansion: Excalidraw Gaps & draw.io Evaluation

**Date:** 2026-04-09
**Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [drawing-feature-expansion](../prds/2026-04-09-drawing-feature-expansion.md) | Complete |
| Tasks | [drawing-feature-expansion-tasks](../tasks/2026-04-09-drawing-feature-expansion-tasks.md) | Complete |

Notesage embeds Excalidraw as an inline drawing canvas. This research audits which Excalidraw features are unused or disabled, and evaluates whether adding draw.io support would create competitive advantage.

---

## Executive Summary

Notesage's current Excalidraw integration (`@excalidraw/excalidraw` v0.18.0) provides the core drawing experience -- all drawing tools (shapes, text, arrows, connectors, freehand, eraser, frames, laser pointer, image embedding) are available out of the box. However, several high-value Excalidraw features are **explicitly disabled or not wired up**: shape libraries, Mermaid-to-Excalidraw conversion, embeddable iframes/websites, custom fonts, and the export dialog. Of these, **shape libraries** is the most impactful gap -- it's the difference between "a blank canvas" and "drag in an AWS architecture diagram in 30 seconds."

Regarding draw.io: adding it would be **hygiene, not a competitive edge**. The note-taking apps that win on diagramming (Obsidian, AFFiNE) all use Excalidraw, not draw.io. Draw.io's strength is structured/technical diagrams (UML, BPMN, ERD), which is a different use case than what Notesage's editor-embedded drawing targets. The integration complexity is also high -- draw.io only works via iframe postMessage, has no React component with state management, and its `.drawio` XML format is heavy and doesn't round-trip to markdown cleanly.

The recommended path is to **deepen the Excalidraw integration** rather than add a second drawing engine. Shape libraries alone would transform the feature from "whiteboard sketching" to "professional diagramming."

---

## 1. Current Excalidraw Integration Audit

### What's fully working (enabled out of the box)

All core Excalidraw tools are available because the `<Excalidraw>` component renders them by default:

| Tool | Status |
| --- | --- |
| Selection, lasso | Available |
| Rectangle, diamond, ellipse | Available |
| Arrow, line (with connectors) | Available |
| Freedraw (pen) | Available |
| Text tool | Available |
| Eraser | Available |
| Hand (pan) tool | Available |
| Frame tool | Available |
| Image embedding | Available (via Excalidraw's built-in image tool) |
| Undo/redo | Available |
| Zoom, pan, scroll | Available |
| Dark/light theme | Available (synced with app theme) |
| Copy/paste elements | Available |
| Group/ungroup | Available |
| Bring forward/send back | Available |
| Lock elements | Available |
| Keyboard shortcuts | Available (within the Excalidraw canvas) |
| Color picker (stroke, fill) | Available |
| Font style selection | Available |
| Element properties panel | Available |

### What's explicitly disabled

```typescript
UIOptions={{
  canvasActions: { saveAsImage: false, loadScene: false },
  welcomeScreen: false,
  dockedSidebarBreakpoint: 0,
}}
```

| Feature | Disabled via | Impact |
| --- | --- | --- |
| Save as Image | `canvasActions.saveAsImage: false` | Low -- Notesage handles export via SVG sidecar |
| Load Scene | `canvasActions.loadScene: false` | Low -- scenes load from `.excalidraw` sidecar files |
| Welcome Screen | `welcomeScreen: false` | None -- correct for embedded use |
| Docked Sidebar | `dockedSidebarBreakpoint: 0` | Medium -- this is where the library panel lives |

### What's not wired up (available in Excalidraw but not exposed)

| Feature | How to enable | Impact | Effort |
| --- | --- | --- | --- |
| **Shape Libraries** | Pass `libraryItems` in `initialData`, handle `onLibraryChange`, set `libraryUrl` prop | **High** -- transforms sketching into diagramming | Medium |
| **Mermaid-to-Excalidraw** | Add `@excalidraw/mermaid-to-excalidraw` package, convert mermaid code blocks | Medium -- AI-generated diagrams | Medium |
| **Embeddable websites/iframes** | Enable via `validateEmbeddable` prop (boolean, regex, or function) | Low -- niche use case in a note editor | Low |
| **Custom fonts** | Pass via `customFonts` prop or CSS | Low -- Excalidraw's defaults work well | Low |
| **Laser pointer** | Already available (tool type `"laser"`) | None -- already works | None |
| **Export dialog** | Set `canvasActions.export` to `true` or custom config | Low -- Notesage manages its own export | Low |
| **Collaboration** | Requires `excalidraw-room` server + WebSocket setup | Low (for now) -- Notesage is local-first | High |
| **AI features** | Requires Excalidraw+ API keys (`generateAIImage`, text-to-diagram) | Low -- separate subscription | N/A |

---

## 2. Shape Libraries -- The Key Gap

### What it is

Excalidraw's library system lets users save, load, and share reusable element collections. The [public library](https://libraries.excalidraw.com/) has hundreds of packs:

- AWS Architecture icons
- Azure/GCP cloud icons
- Network topology shapes
- UI wireframe components
- Flowchart symbols
- Kubernetes/Docker diagrams
- Database schema elements
- System design primitives

### Why it matters

Without libraries, every diagram starts from scratch with basic shapes. With libraries, a user can drag in a pre-made AWS EC2 instance, connect it to an RDS icon, and have a professional architecture diagram in minutes.

### How to implement

```typescript
// 1. Load persisted library items
const libraryItems = await loadLibraryFromDisk(); // from .notesage/excalidraw-library.json

// 2. Pass to Excalidraw
<Excalidraw
  initialData={{ libraryItems }}
  onLibraryChange={(items) => saveLibraryToDisk(items)}
  libraryReturnUrl={window.location.href}  // enables "Add to Excalidraw" from libraries.excalidraw.com
/>
```

**Storage:** Library items persist as `.excalidrawlib` JSON in `~/.notesage/excalidraw-library.json` (global) or `<project>/.notesage/excalidraw-library.json` (per-project).

**Effort estimate:** Small-medium. The Excalidraw component already supports this via props -- the work is persistence, the library panel UX (re-enabling the docked sidebar), and possibly a "Browse Libraries" button.

---

## 3. Mermaid-to-Excalidraw

### What it is

The official `@excalidraw/mermaid-to-excalidraw` package converts Mermaid diagram syntax into native Excalidraw elements. Currently supports flowcharts; other diagram types render as images.

### Why it matters for Notesage

Notesage has AI chat with tool calling. A natural workflow is:
1. User asks AI: "Draw an architecture diagram for this system"
2. AI generates Mermaid syntax (which all LLMs can do well)
3. Mermaid converts to editable Excalidraw elements
4. User refines the diagram visually

This bridges AI text output and visual editing -- a strong differentiator.

### How to implement

```typescript
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";

const { elements, files } = await parseMermaidToExcalidraw(mermaidSyntax);
excalidrawAPI.updateScene({ elements });
```

**Effort estimate:** Medium. The conversion library exists; the work is integrating it into the AI workflow (detecting mermaid blocks, offering "Open in drawing" action).

---

## 4. draw.io Evaluation

### Integration approach

draw.io has no native React component. The only integration path is:

1. **iframe embed** via `https://embed.diagrams.net` with postMessage API
2. **react-drawio** community wrapper (~200 GitHub stars, thin wrapper around the iframe)
3. **Self-hosted** draw.io instance embedded in iframe

All approaches use an iframe with `postMessage` for bidirectional communication (load XML, receive save events). This is fundamentally different from Excalidraw's deep React integration.

### Technical comparison

| Criterion | Excalidraw (current) | draw.io |
| --- | --- | --- |
| **Integration model** | Native React component, full state access | iframe + postMessage (black box) |
| **Bundle impact** | Already bundled (~800KB) | Additional iframe load (~3MB) |
| **Offline support** | Full (bundled JS) | Requires self-hosting or online |
| **File format** | JSON (`.excalidraw`) -- simple, readable | XML (`.drawio`) -- verbose, complex |
| **Markdown round-trip** | Clean: `![drawing](path.excalidraw)` | Would need separate syntax/storage |
| **Theme integration** | Full CSS variable control | Limited (iframe isolation) |
| **React state access** | Direct: `getSceneElements()`, `updateScene()` | None -- postMessage only |
| **SVG export** | Programmatic, theme-aware dual export | Via postMessage callback |
| **Shape libraries** | 500+ community libraries | 5,000+ shapes built-in |
| **Structured diagrams** | Basic (manual layout) | Excellent (auto-layout, UML, ERD, BPMN) |
| **Hand-drawn aesthetic** | Yes (signature style) | No (precise/formal) |
| **License** | MIT | Apache 2.0 |

### Competitive landscape

| App | Drawing tool | Diagramming | Notes |
| --- | --- | --- | --- |
| **Obsidian** | Excalidraw plugin (most popular drawing plugin) | Mermaid (native), Excalidraw | No draw.io |
| **AFFiNE** | Built-in whiteboard (Excalidraw-based) | Mermaid | No draw.io |
| **Notion** | None native | Mermaid blocks, embed external | No draw.io |
| **Craft** | None | None | No draw.io |
| **Bear** | None | None | No draw.io |
| **Typora** | None | Mermaid (native) | No draw.io |
| **VS Code** | draw.io extension | Mermaid preview | draw.io as extension, not core |
| **Confluence** | Excalidraw + draw.io plugins | Both available | Enterprise context |

**Key finding:** No direct competitor in the note-taking space uses draw.io as a core feature. It's an IDE/enterprise tool, not a writing tool.

### draw.io verdict

| Dimension | Assessment |
| --- | --- |
| **Competitive edge?** | No -- no note-taking competitor has it; adding it won't differentiate |
| **Hygiene?** | Barely -- users who need draw.io already have it in VS Code or browser |
| **User demand signal** | Low -- Excalidraw's hand-drawn style is preferred for note-embedded diagrams |
| **Implementation cost** | High -- iframe isolation, dual format storage, no theme integration |
| **Maintenance burden** | Medium -- tracking draw.io's embed API changes, dual-engine bugs |
| **Better alternative** | Mermaid rendering (text-to-diagram) covers the "structured diagram" gap more naturally |

---

## 5. Alternative: Mermaid as the Structured Diagram Path

Rather than adding draw.io for structured diagrams, Mermaid covers the gap more naturally:

| Criterion | draw.io | Mermaid |
| --- | --- | --- |
| **UML/flowcharts** | Excellent | Good (most common types) |
| **Learning curve** | GUI (drag-drop) | Text syntax (AI can generate) |
| **AI compatibility** | Poor (needs visual interaction) | Excellent (text in, diagram out) |
| **Markdown native** | No (separate format) | Yes (fenced code blocks) |
| **Editing after creation** | Visual only | Text or visual (via Excalidraw conversion) |
| **Integration effort** | High (iframe) | Low-medium (renderer + optional Excalidraw conversion) |
| **File size** | Large (XML) | Tiny (text) |

Mermaid + Excalidraw conversion gives users both paths: text-first for AI-generated and quick diagrams, visual-first for freehand work.

---

## Comparison Matrix

| Feature | Priority | Effort | Impact | Recommendation |
| --- | --- | --- | --- | --- |
| Shape Libraries | P1 | Medium | High -- transforms sketching to diagramming | **Implement** |
| Mermaid-to-Excalidraw | P2 | Medium | Medium -- AI diagram generation | **Implement** (after libraries) |
| Mermaid code block rendering | P2 | Medium | Medium -- inline diagram preview | **Implement** (pairs with above) |
| draw.io support | P4 | High | Low -- no competitive signal | **Skip** |
| Embeddable iframes | P3 | Low | Low -- niche use case | **Consider later** |
| Custom fonts | P4 | Low | Low -- defaults are fine | **Skip** |
| Collaboration | P5 | Very High | Medium -- requires CRDT/server | **Future (post-collaboration)** |

---

## Recommendation

### Phase 1: Shape Libraries (P1)

Enable the library system that Excalidraw already supports:
- Re-enable the docked sidebar (set `dockedSidebarBreakpoint` to a reasonable value, e.g., `640`)
- Wire up `initialData.libraryItems` from persisted storage
- Handle `onLibraryChange` to save library items to disk
- Set `libraryReturnUrl` to enable one-click install from libraries.excalidraw.com
- Storage: `~/.notesage/excalidraw-library.json` (global)

### Phase 2: Mermaid Integration (P2)

Add Mermaid as a complementary diagram path:
- Render mermaid code blocks as inline diagrams in the editor (using `mermaid` npm package)
- Add "Convert to Drawing" action on mermaid blocks (using `@excalidraw/mermaid-to-excalidraw`)
- AI chat can generate mermaid blocks that become editable drawings

### Skip: draw.io

No competitive signal, high integration cost, iframe-only architecture conflicts with Notesage's deep-integration philosophy. Users who need draw.io use it separately.

---

## Open Questions

- Should shape libraries be global-only or support per-project libraries?
- Should Mermaid rendering be a Tiptap node extension (inline preview) or a separate viewer?
- Is there demand for exporting Excalidraw drawings to other formats (PNG, PDF) from within Notesage, or is the SVG sidecar sufficient?
- Should the Excalidraw "Save as Image" action be re-enabled as a convenience, now that the canvas is more capable?
