---
name: insert-drawing
description: Insert Excalidraw drawings into Notesage documents
user-invocable: true
---

# Insert Drawing

Insert an inline Excalidraw drawing into a Notesage markdown document. Drawings render natively in the editor as interactive canvases and export to PDF, DOCX, and HTML.

## How It Works

Notesage drawings are stored as two pieces:
1. An **Excalidraw JSON file** in `.notesage/drawings/{id}.excalidraw` containing the drawing elements
2. A **markdown image reference** `![drawing](/.notesage/drawings/{id}.excalidraw)` in the document

When the editor sees this markdown pattern, it renders the drawing inline. The SVG preview is auto-generated from the JSON.

## Quick Example

A complete 3-box flowchart (Start → Process → End). This is a working file you can use directly:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "notesage",
  "elements": [
    {
      "id": "start", "type": "rectangle", "x": 100, "y": 100, "width": 120, "height": 50,
      "backgroundColor": "#e3f2fd", "roundness": { "type": 3 },
      "boundElements": [{ "id": "t1", "type": "text" }, { "id": "a1", "type": "arrow" }]
    },
    { "id": "t1", "type": "text", "x": 100, "y": 100, "width": 120, "height": 50, "text": "Start", "originalText": "Start", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "start", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "process", "type": "rectangle", "x": 100, "y": 210, "width": 120, "height": 50,
      "backgroundColor": "#fff3e0",
      "boundElements": [{ "id": "t2", "type": "text" }, { "id": "a1", "type": "arrow" }, { "id": "a2", "type": "arrow" }]
    },
    { "id": "t2", "type": "text", "x": 100, "y": 210, "width": 120, "height": 50, "text": "Process", "originalText": "Process", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "process", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "end", "type": "rectangle", "x": 100, "y": 320, "width": 120, "height": 50,
      "backgroundColor": "#e8f5e9", "roundness": { "type": 3 },
      "boundElements": [{ "id": "t3", "type": "text" }, { "id": "a2", "type": "arrow" }]
    },
    { "id": "t3", "type": "text", "x": 100, "y": 320, "width": 120, "height": 50, "text": "End", "originalText": "End", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "end", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "a1", "type": "arrow", "x": 160, "y": 150, "width": 0, "height": 60,
      "points": [[0, 0], [0, 60]],
      "startBinding": { "elementId": "start", "focus": 0, "gap": 1 },
      "endBinding": { "elementId": "process", "focus": 0, "gap": 1 },
      "startArrowhead": null, "endArrowhead": "arrow"
    },
    {
      "id": "a2", "type": "arrow", "x": 160, "y": 260, "width": 0, "height": 60,
      "points": [[0, 0], [0, 60]],
      "startBinding": { "elementId": "process", "focus": 0, "gap": 1 },
      "endBinding": { "elementId": "end", "focus": 0, "gap": 1 },
      "startArrowhead": null, "endArrowhead": "arrow"
    }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" }
}
```

## Workflow

**IMPORTANT — Write order matters.** The editor deletes orphaned drawing files after 5 seconds. You MUST insert the markdown reference into the document BEFORE (or immediately after) writing the `.excalidraw` file.

1. **Generate a unique ID** (e.g., `drawing-1712345678-abc`).

2. **Read the current document** to find where to insert the drawing.

3. **Insert the markdown reference** and save the document:
   ```markdown
   ![drawing](/.notesage/drawings/{id}.excalidraw)
   ```
   This must be on its own paragraph (blank lines above and below).

4. **Write the Excalidraw JSON** to `<project_root>/.notesage/drawings/{id}.excalidraw`.

5. **Done.** The editor renders the drawing automatically. Users can click to edit it.

**Tell the user:** The drawing will appear inline. They can click it to open the Excalidraw editor and refine shapes, colors, or layout.

## Element Defaults

Most fields have defaults — you only need to specify the fields that differ. The Excalidraw renderer fills in everything else automatically.

**Fields you MUST provide per element:**

| Field | Description |
|-------|-------------|
| `id` | Unique string (e.g., `"box-1"`, `"arrow-a"`) |
| `type` | `"rectangle"`, `"ellipse"`, `"diamond"`, `"text"`, `"arrow"`, `"line"` |
| `x`, `y` | Position (pixels, origin top-left) |
| `width`, `height` | Size in pixels |

**Fields with usable defaults (omit unless you need a different value):**

| Field | Default | When to override |
|-------|---------|-----------------|
| `strokeColor` | `"#1e1e1e"` | White text on dark backgrounds: `"#ffffff"` |
| `backgroundColor` | `"transparent"` | Colored boxes: `"#e3f2fd"` (blue), `"#fff3e0"` (orange), `"#e8f5e9"` (green) |
| `fillStyle` | `"solid"` | Rarely |
| `strokeWidth` | `2` | Thin lines: `1`, thick: `4` |
| `roughness` | `1` | Clean lines: `0` |
| `opacity` | `100` | Rarely |
| `angle` | `0` | Rotated elements |
| `seed` | Random | Always fine to omit |
| `version` | `1` | Always fine to omit |
| `versionNonce` | Random | Always fine to omit |
| `isDeleted` | `false` | Never override |
| `groupIds` | `[]` | Grouped elements |
| `boundElements` | `null` | **Override when shapes have arrows or text** |
| `locked` | `false` | Never override |

**Additional required fields by type:**

| Type | Extra fields |
|------|-------------|
| `text` | `text`, `originalText`, `fontSize` (20), `fontFamily` (2), `textAlign` ("center"), `verticalAlign` ("middle"), `containerId` (shape id or null), `autoResize` (true), `lineHeight` (1.25) |
| `arrow` | `points` ([[0,0],[dx,dy]]), `startBinding`, `endBinding`, `startArrowhead` (null), `endArrowhead` ("arrow") |
| `line` | `points` ([[0,0],[dx,dy]]) |

## Element Template

Copy this skeleton and change only the fields you need:

**Shape (rectangle, ellipse, diamond):**
```json
{ "id": "CHANGE", "type": "rectangle", "x": 0, "y": 0, "width": 120, "height": 50, "boundElements": [] }
```

**Text label (bound to a shape):**
```json
{ "id": "CHANGE", "type": "text", "x": 0, "y": 0, "width": 120, "height": 50, "text": "CHANGE", "originalText": "CHANGE", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "SHAPE_ID", "autoResize": true, "lineHeight": 1.25 }
```

**Arrow (connecting two shapes):**
```json
{ "id": "CHANGE", "type": "arrow", "x": 0, "y": 0, "width": 0, "height": 60, "points": [[0, 0], [0, 60]], "startBinding": { "elementId": "FROM_ID", "focus": 0, "gap": 1 }, "endBinding": { "elementId": "TO_ID", "focus": 0, "gap": 1 }, "startArrowhead": null, "endArrowhead": "arrow" }
```

**Remember:** When binding text or arrows to a shape, add them to the shape's `boundElements` array:
```json
"boundElements": [{ "id": "text-id", "type": "text" }, { "id": "arrow-id", "type": "arrow" }]
```

## Tips

- **Start simple.** Build 2-3 shapes first, verify it renders, then expand.
- **Standard sizing:** Rectangles at 120x50, spacing of 60px between shapes.
- **Bind arrows to shapes** so they stay connected when moved. Always set both the arrow's binding AND the shape's `boundElements`.
- **Excalidraw is the preferred approach for all diagrams** — flowcharts, architecture diagrams, wireframes, mind maps, process flows. Drawings are interactive: the user can click to edit shapes, colors, and layout in a canvas. Only use `insert-diagram` (Mermaid) when the user explicitly requests Mermaid syntax.
- Colors: `"#e3f2fd"` (blue), `"#fff3e0"` (orange), `"#e8f5e9"` (green), `"#fce4ec"` (pink), `"#f3e5f5"` (purple)

## Troubleshooting

- **Drawing not visible:** Make sure the markdown reference is in the document. The editor auto-generates the SVG preview from the JSON.
- **Drawing disappears:** The editor deletes orphaned files after 5 seconds. Insert the markdown reference FIRST.
- **Arrow not connecting:** The arrow needs `startBinding`/`endBinding` AND the shape needs the arrow in `boundElements`. Both sides must match.

## References

- `references/EXCALIDRAW-SCHEMA.md` — Full JSON schema with all field details
- `references/examples/` — Complete working examples (one file per diagram type)
