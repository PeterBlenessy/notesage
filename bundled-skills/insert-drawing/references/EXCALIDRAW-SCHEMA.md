# Excalidraw JSON Schema

The Excalidraw drawing file (`.notesage/drawings/{id}.excalidraw`) must conform to the following structure. Notesage renders drawings using the Excalidraw engine, so the format is fully compatible with excalidraw.com.

## Top-Level Object

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "notesage",
  "elements": [<Element>, ...],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"excalidraw"` |
| `version` | number | Yes | Always `2` |
| `source` | string | Yes | Always `"notesage"` |
| `elements` | Element[] | Yes | Array of drawing elements |
| `appState` | object | Yes | Application state. Only `viewBackgroundColor` is needed. |

## Common Element Fields

Every element needs these 5 fields. All other fields have defaults and can be omitted.

**Required fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., `"start-box"`, `"arrow-1"`) |
| `type` | string | Element type: `"rectangle"`, `"ellipse"`, `"diamond"`, `"text"`, `"arrow"`, `"line"`, `"freedraw"` |
| `x` | number | X position in pixels (increases rightward) |
| `y` | number | Y position in pixels (increases downward) |
| `width` | number | Width in pixels |
| `height` | number | Height in pixels |

**Optional fields (defaults filled by the renderer):**

| Field | Default | Description |
|-------|---------|-------------|
| `strokeColor` | `"#1e1e1e"` | Border/stroke color |
| `backgroundColor` | `"transparent"` | Fill color (e.g., `"#e3f2fd"` for blue) |
| `fillStyle` | `"solid"` | Fill pattern: `"solid"`, `"hachure"`, `"cross-hatch"` |
| `strokeWidth` | `2` | Stroke thickness: `1` (thin), `2` (normal), `4` (thick) |
| `roughness` | `1` | Hand-drawn effect: `0` (clean), `1` (slight), `2` (sketchy) |
| `opacity` | `100` | 0 (invisible) to 100 (fully opaque) |
| `angle` | `0` | Rotation in radians |
| `seed` | random | Random int for roughness. Safe to omit. |
| `version` | `1` | Element version. Safe to omit. |
| `versionNonce` | random | Version tracking. Safe to omit. |
| `isDeleted` | `false` | Always omit (false). |
| `groupIds` | `[]` | Group membership. Omit for ungrouped. |
| `boundElements` | `null` | **Set this when the shape has arrows or text bound to it.** |
| `updated` | `1` | Timestamp. Safe to omit. |
| `link` | `null` | URL link. Safe to omit. |
| `locked` | `false` | Lock state. Safe to omit. |
| `roundness` | `null` | Set `{ "type": 3 }` for rounded corners on rectangles. |

## Coordinate System

- Origin (0, 0) is the top-left corner
- X increases to the right
- Y increases downward
- All positions and sizes are in pixels
- Elements are positioned by their top-left corner (x, y)

## Element Types

### Rectangle

Standard rectangular shape. The most common element for boxes, containers, and steps.

Uses only the common fields. No additional fields needed.

```json
{
  "type": "rectangle",
  "x": 100, "y": 100,
  "width": 150, "height": 60
}
```

Tip: For rounded corners, set `"roundness": { "type": 3 }`. Omit for sharp corners.

### Ellipse

Oval or circle shape. Width and height define the bounding box.

Uses only the common fields. For a perfect circle, set `width` equal to `height`.

```json
{
  "type": "ellipse",
  "x": 100, "y": 100,
  "width": 80, "height": 80
}
```

### Diamond

Diamond/rhombus shape. Commonly used for decision nodes.

Uses only the common fields. The diamond is inscribed within the width/height bounding box.

```json
{
  "type": "diamond",
  "x": 100, "y": 100,
  "width": 120, "height": 80
}
```

### Text

Standalone text label. Can be placed anywhere or bound inside a container shape.

Additional fields beyond the common set:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | The display text |
| `fontSize` | number | Yes | Font size in pixels. `20` is standard. |
| `fontFamily` | number | Yes | Font: `1` (hand-drawn), `2` (normal), `3` (monospace) |
| `textAlign` | string | Yes | Horizontal: `"left"`, `"center"`, `"right"` |
| `verticalAlign` | string | Yes | Vertical: `"top"`, `"middle"`, `"bottom"` |
| `containerId` | string/null | Yes | ID of container shape, or `null` for standalone text |
| `originalText` | string | Yes | Same as `text` |
| `autoResize` | boolean | Yes | Always `true` for generated text |
| `lineHeight` | number | Yes | Line height multiplier. Use `1.25`. |

```json
{
  "type": "text",
  "text": "Start",
  "fontSize": 20,
  "fontFamily": 2,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": "start-box",
  "originalText": "Start",
  "autoResize": true,
  "lineHeight": 1.25
}
```

When binding text to a container shape:
- Set `containerId` to the shape's `id`
- Set the text's `x`, `y`, `width`, `height` to match the container's position/size
- Add `{ "id": "<text-id>", "type": "text" }` to the container's `boundElements` array

### Arrow

Line with optional arrowheads and shape bindings.

Additional fields beyond the common set:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `points` | number[][] | Yes | Array of [x, y] offset points. Minimum: `[[0, 0], [endX, endY]]`. |
| `startBinding` | object/null | Yes | Binding to start shape, or `null` |
| `endBinding` | object/null | Yes | Binding to end shape, or `null` |
| `startArrowhead` | string/null | Yes | Start arrowhead: `null` (none), `"arrow"`, `"dot"`, `"bar"` |
| `endArrowhead` | string/null | Yes | End arrowhead: `null` (none), `"arrow"`, `"dot"`, `"bar"` |

```json
{
  "type": "arrow",
  "x": 250, "y": 130,
  "width": 100, "height": 0,
  "points": [[0, 0], [100, 0]],
  "startBinding": null,
  "endBinding": null,
  "startArrowhead": null,
  "endArrowhead": "arrow"
}
```

**Binding arrows to shapes:**

To connect an arrow to shapes, set the binding objects:

```json
{
  "startBinding": {
    "elementId": "source-shape-id",
    "focus": 0,
    "gap": 1
  },
  "endBinding": {
    "elementId": "target-shape-id",
    "focus": 0,
    "gap": 1
  }
}
```

| Binding Field | Description |
|---------------|-------------|
| `elementId` | ID of the shape to bind to |
| `focus` | Position along the shape edge: `0` = center, `-1` = one end, `1` = other end |
| `gap` | Pixel gap between arrow tip and shape edge. Use `1`. |

**Important:** When binding an arrow to a shape, you must also add the arrow to the shape's `boundElements` array:

```json
{
  "id": "my-shape",
  "type": "rectangle",
  "boundElements": [
    { "id": "my-arrow", "type": "arrow" }
  ]
}
```

### Line

Plain line without arrowheads. Uses the same `points` field as arrows but without binding or arrowhead fields.

Additional fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `points` | number[][] | Yes | Array of [x, y] offset points |

### Freedraw

Freehand drawing path.

Additional fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `points` | number[][] | Yes | Array of [x, y] points tracing the path |
| `simulatePressure` | boolean | Yes | Vary stroke width to simulate pen pressure. Use `true`. |

## Validation Rules

- `elements` must have at least 1 entry
- Every element must have a unique `id`
- `seed` and `versionNonce` must be integers (any random value works)
- Arrow `points` must have at least 2 entries
- Text `containerId` must reference an existing element `id` if not `null`
- Bound elements must be bidirectional: if arrow A binds to shape S, then S's `boundElements` must include A
