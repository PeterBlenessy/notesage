# Embedded Drawing Examples

Examples of inline Excalidraw drawings using the ```` ```excalidraw ```` fenced code block format. Copy any example directly into a markdown document — the editor renders it as an interactive drawing that can be edited in place.

## Format

Drawings are embedded as Excalidraw scene JSON inside a fenced code block:

````
```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [...],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```
````

Click the rendered drawing to open the full Excalidraw editor. Changes save back to the inline JSON automatically.

## Element Types

Excalidraw supports: `rectangle`, `ellipse`, `diamond`, `text`, `line`, `arrow`, `freedraw`, `frame`, and `image`.

---

## 1. Simple Rectangle

A single rectangle with default styling.

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "rect1",
      "type": "rectangle",
      "x": 100,
      "y": 80,
      "width": 200,
      "height": 120,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 3 },
      "seed": 1001,
      "version": 1,
      "versionNonce": 2001,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

---

## 2. Basic Shapes — Rectangle, Ellipse, Diamond

Three shapes side by side demonstrating the core shape types.

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "shape-rect",
      "type": "rectangle",
      "x": 50,
      "y": 80,
      "width": 140,
      "height": 100,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#a5d8ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 3 },
      "seed": 1100,
      "version": 1,
      "versionNonce": 2100,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false
    },
    {
      "id": "shape-ellipse",
      "type": "ellipse",
      "x": 230,
      "y": 80,
      "width": 140,
      "height": 100,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#b2f2bb",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 2 },
      "seed": 1200,
      "version": 1,
      "versionNonce": 2200,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false
    },
    {
      "id": "shape-diamond",
      "type": "diamond",
      "x": 410,
      "y": 60,
      "width": 120,
      "height": 140,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#ffec99",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 2 },
      "seed": 1300,
      "version": 1,
      "versionNonce": 2300,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

---

## 3. Text Label

A standalone text element.

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "text1",
      "type": "text",
      "x": 100,
      "y": 80,
      "width": 240,
      "height": 35,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": null,
      "seed": 1400,
      "version": 1,
      "versionNonce": 2400,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "text": "Hello, Notesage!",
      "fontSize": 28,
      "fontFamily": 1,
      "textAlign": "left",
      "verticalAlign": "top",
      "containerId": null,
      "originalText": "Hello, Notesage!",
      "autoResize": true,
      "lineHeight": 1.25
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

---

## 4. Arrow Between Shapes

Two rectangles connected by an arrow, demonstrating bound elements.

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "box-a",
      "type": "rectangle",
      "x": 50,
      "y": 100,
      "width": 120,
      "height": 60,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#e9ecef",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 3 },
      "seed": 1500,
      "version": 1,
      "versionNonce": 2500,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        { "id": "arrow1", "type": "arrow" }
      ],
      "updated": 1712700000000,
      "link": null,
      "locked": false
    },
    {
      "id": "box-b",
      "type": "rectangle",
      "x": 350,
      "y": 100,
      "width": 120,
      "height": 60,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#e9ecef",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 3 },
      "seed": 1600,
      "version": 1,
      "versionNonce": 2600,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        { "id": "arrow1", "type": "arrow" }
      ],
      "updated": 1712700000000,
      "link": null,
      "locked": false
    },
    {
      "id": "arrow1",
      "type": "arrow",
      "x": 170,
      "y": 130,
      "width": 180,
      "height": 0,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 2 },
      "seed": 1700,
      "version": 1,
      "versionNonce": 2700,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "points": [[0, 0], [180, 0]],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "box-a",
        "focus": 0,
        "gap": 1,
        "fixedPoint": null
      },
      "endBinding": {
        "elementId": "box-b",
        "focus": 0,
        "gap": 1,
        "fixedPoint": null
      },
      "startArrowhead": null,
      "endArrowhead": "arrow",
      "elbowed": false
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

---

## 5. Flowchart — Decision Process

A simple yes/no flowchart with diamonds, rectangles, and arrows.

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "fc-start",
      "type": "rectangle",
      "x": 160,
      "y": 20,
      "width": 140,
      "height": 50,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#a5d8ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 3 },
      "seed": 3001,
      "version": 1,
      "versionNonce": 4001,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        { "id": "fc-text-start", "type": "text" },
        { "id": "fc-arrow1", "type": "arrow" }
      ],
      "updated": 1712700000000,
      "link": null,
      "locked": false
    },
    {
      "id": "fc-text-start",
      "type": "text",
      "x": 200,
      "y": 32,
      "width": 60,
      "height": 25,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": null,
      "seed": 3002,
      "version": 1,
      "versionNonce": 4002,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "text": "Start",
      "fontSize": 20,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "fc-start",
      "originalText": "Start",
      "autoResize": true,
      "lineHeight": 1.25
    },
    {
      "id": "fc-arrow1",
      "type": "arrow",
      "x": 230,
      "y": 70,
      "width": 0,
      "height": 40,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 2 },
      "seed": 3003,
      "version": 1,
      "versionNonce": 4003,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "points": [[0, 0], [0, 40]],
      "lastCommittedPoint": null,
      "startBinding": { "elementId": "fc-start", "focus": 0, "gap": 1, "fixedPoint": null },
      "endBinding": { "elementId": "fc-decision", "focus": 0, "gap": 1, "fixedPoint": null },
      "startArrowhead": null,
      "endArrowhead": "arrow",
      "elbowed": false
    },
    {
      "id": "fc-decision",
      "type": "diamond",
      "x": 155,
      "y": 110,
      "width": 150,
      "height": 100,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#ffec99",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 2 },
      "seed": 3004,
      "version": 1,
      "versionNonce": 4004,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        { "id": "fc-text-decision", "type": "text" },
        { "id": "fc-arrow1", "type": "arrow" },
        { "id": "fc-arrow-yes", "type": "arrow" },
        { "id": "fc-arrow-no", "type": "arrow" }
      ],
      "updated": 1712700000000,
      "link": null,
      "locked": false
    },
    {
      "id": "fc-text-decision",
      "type": "text",
      "x": 195,
      "y": 147,
      "width": 70,
      "height": 25,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": null,
      "seed": 3005,
      "version": 1,
      "versionNonce": 4005,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "text": "Ready?",
      "fontSize": 20,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "fc-decision",
      "originalText": "Ready?",
      "autoResize": true,
      "lineHeight": 1.25
    },
    {
      "id": "fc-arrow-yes",
      "type": "arrow",
      "x": 305,
      "y": 160,
      "width": 75,
      "height": 0,
      "angle": 0,
      "strokeColor": "#2f9e44",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 2 },
      "seed": 3006,
      "version": 1,
      "versionNonce": 4006,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "points": [[0, 0], [75, 0]],
      "lastCommittedPoint": null,
      "startBinding": { "elementId": "fc-decision", "focus": 0, "gap": 1, "fixedPoint": null },
      "endBinding": { "elementId": "fc-yes", "focus": 0, "gap": 1, "fixedPoint": null },
      "startArrowhead": null,
      "endArrowhead": "arrow",
      "elbowed": false
    },
    {
      "id": "fc-yes",
      "type": "rectangle",
      "x": 380,
      "y": 135,
      "width": 120,
      "height": 50,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#b2f2bb",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 3 },
      "seed": 3007,
      "version": 1,
      "versionNonce": 4007,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        { "id": "fc-text-yes", "type": "text" },
        { "id": "fc-arrow-yes", "type": "arrow" }
      ],
      "updated": 1712700000000,
      "link": null,
      "locked": false
    },
    {
      "id": "fc-text-yes",
      "type": "text",
      "x": 405,
      "y": 147,
      "width": 70,
      "height": 25,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": null,
      "seed": 3008,
      "version": 1,
      "versionNonce": 4008,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "text": "Ship it!",
      "fontSize": 20,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "fc-yes",
      "originalText": "Ship it!",
      "autoResize": true,
      "lineHeight": 1.25
    },
    {
      "id": "fc-arrow-no",
      "type": "arrow",
      "x": 230,
      "y": 210,
      "width": 0,
      "height": 40,
      "angle": 0,
      "strokeColor": "#e03131",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 2 },
      "seed": 3009,
      "version": 1,
      "versionNonce": 4009,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "points": [[0, 0], [0, 40]],
      "lastCommittedPoint": null,
      "startBinding": { "elementId": "fc-decision", "focus": 0, "gap": 1, "fixedPoint": null },
      "endBinding": { "elementId": "fc-no", "focus": 0, "gap": 1, "fixedPoint": null },
      "startArrowhead": null,
      "endArrowhead": "arrow",
      "elbowed": false
    },
    {
      "id": "fc-no",
      "type": "rectangle",
      "x": 160,
      "y": 250,
      "width": 140,
      "height": 50,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#ffc9c9",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 3 },
      "seed": 3010,
      "version": 1,
      "versionNonce": 4010,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        { "id": "fc-text-no", "type": "text" },
        { "id": "fc-arrow-no", "type": "arrow" }
      ],
      "updated": 1712700000000,
      "link": null,
      "locked": false
    },
    {
      "id": "fc-text-no",
      "type": "text",
      "x": 185,
      "y": 262,
      "width": 90,
      "height": 25,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": null,
      "seed": 3011,
      "version": 1,
      "versionNonce": 4011,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "text": "Iterate",
      "fontSize": 20,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "fc-no",
      "originalText": "Iterate",
      "autoResize": true,
      "lineHeight": 1.25
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

---

## 6. Fill Styles — Hachure, Cross-hatch, Solid

Three rectangles demonstrating different fill styles with the hand-drawn (roughness) look.

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "fill-hachure",
      "type": "rectangle",
      "x": 50,
      "y": 80,
      "width": 130,
      "height": 90,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#a5d8ff",
      "fillStyle": "hachure",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 2,
      "opacity": 100,
      "roundness": null,
      "seed": 5001,
      "version": 1,
      "versionNonce": 6001,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false
    },
    {
      "id": "fill-crosshatch",
      "type": "rectangle",
      "x": 220,
      "y": 80,
      "width": 130,
      "height": 90,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#b2f2bb",
      "fillStyle": "cross-hatch",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 2,
      "opacity": 100,
      "roundness": null,
      "seed": 5002,
      "version": 1,
      "versionNonce": 6002,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false
    },
    {
      "id": "fill-solid",
      "type": "rectangle",
      "x": 390,
      "y": 80,
      "width": 130,
      "height": 90,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#ffec99",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "roundness": { "type": 3 },
      "seed": 5003,
      "version": 1,
      "versionNonce": 6003,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

- `roughness: 0` = architect (clean), `1` = artist (default), `2` = cartoonist (sketchy)
- `fillStyle`: `"hachure"` (diagonal lines), `"cross-hatch"` (grid lines), `"solid"` (flat fill)

---

## 7. Lines and Stroke Styles

Lines with different stroke styles: solid, dashed, and dotted.

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "line-solid",
      "type": "line",
      "x": 50,
      "y": 60,
      "width": 300,
      "height": 0,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 2 },
      "seed": 7001,
      "version": 1,
      "versionNonce": 8001,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "points": [[0, 0], [300, 0]],
      "lastCommittedPoint": null,
      "startBinding": null,
      "endBinding": null,
      "startArrowhead": null,
      "endArrowhead": null
    },
    {
      "id": "line-dashed",
      "type": "line",
      "x": 50,
      "y": 110,
      "width": 300,
      "height": 0,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "dashed",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 2 },
      "seed": 7002,
      "version": 1,
      "versionNonce": 8002,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "points": [[0, 0], [300, 0]],
      "lastCommittedPoint": null,
      "startBinding": null,
      "endBinding": null,
      "startArrowhead": null,
      "endArrowhead": null
    },
    {
      "id": "line-dotted",
      "type": "line",
      "x": 50,
      "y": 160,
      "width": 300,
      "height": 0,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "dotted",
      "roughness": 1,
      "opacity": 100,
      "roundness": { "type": 2 },
      "seed": 7003,
      "version": 1,
      "versionNonce": 8003,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "points": [[0, 0], [300, 0]],
      "lastCommittedPoint": null,
      "startBinding": null,
      "endBinding": null,
      "startArrowhead": null,
      "endArrowhead": null
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

---

## 8. Grouped Elements — Card

Elements with matching `groupIds` move and resize together. This card has a background rectangle grouped with a title and body text.

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "card-bg",
      "type": "rectangle",
      "x": 80,
      "y": 50,
      "width": 280,
      "height": 160,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#f8f9fa",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "roundness": { "type": 3 },
      "seed": 9001,
      "version": 1,
      "versionNonce": 9101,
      "index": null,
      "isDeleted": false,
      "groupIds": ["group-card"],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false
    },
    {
      "id": "card-title",
      "type": "text",
      "x": 100,
      "y": 70,
      "width": 200,
      "height": 30,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "roundness": null,
      "seed": 9002,
      "version": 1,
      "versionNonce": 9102,
      "index": null,
      "isDeleted": false,
      "groupIds": ["group-card"],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "text": "Feature Card",
      "fontSize": 24,
      "fontFamily": 1,
      "textAlign": "left",
      "verticalAlign": "top",
      "containerId": null,
      "originalText": "Feature Card",
      "autoResize": true,
      "lineHeight": 1.25
    },
    {
      "id": "card-body",
      "type": "text",
      "x": 100,
      "y": 115,
      "width": 240,
      "height": 60,
      "angle": 0,
      "strokeColor": "#868e96",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "roundness": null,
      "seed": 9003,
      "version": 1,
      "versionNonce": 9103,
      "index": null,
      "isDeleted": false,
      "groupIds": ["group-card"],
      "frameId": null,
      "boundElements": null,
      "updated": 1712700000000,
      "link": null,
      "locked": false,
      "text": "Inline drawings are\nself-contained in the\nmarkdown file.",
      "fontSize": 16,
      "fontFamily": 1,
      "textAlign": "left",
      "verticalAlign": "top",
      "containerId": null,
      "originalText": "Inline drawings are\nself-contained in the\nmarkdown file.",
      "autoResize": true,
      "lineHeight": 1.25
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

---

## Property Reference

### Common Properties

| Property | Type | Description |
|----------|------|-------------|
| `strokeColor` | hex string | Outline color (e.g. `"#1e1e1e"`) |
| `backgroundColor` | hex or `"transparent"` | Fill color |
| `fillStyle` | `"solid"`, `"hachure"`, `"cross-hatch"`, `"zigzag"` | Fill pattern |
| `strokeWidth` | number | Line thickness (1-4) |
| `strokeStyle` | `"solid"`, `"dashed"`, `"dotted"` | Outline style |
| `roughness` | number | 0 = architect, 1 = artist, 2 = cartoonist |
| `opacity` | number | 0-100 |
| `roundness` | `null` or `{ "type": 3 }` | Rounded corners (type 3 for shapes, type 2 for lines) |
| `angle` | number | Rotation in radians |
| `groupIds` | string[] | Group membership (elements with same ID move together) |

### Text Properties

| Property | Type | Description |
|----------|------|-------------|
| `text` | string | Display text (use `\n` for newlines) |
| `fontSize` | number | Font size in pixels |
| `fontFamily` | number | 1 = Excalifont (hand-drawn), 2 = Nunito, 3 = Cascadia (mono) |
| `textAlign` | `"left"`, `"center"`, `"right"` | Horizontal alignment |
| `verticalAlign` | `"top"`, `"middle"`, `"bottom"` | Vertical alignment |
| `containerId` | string or `null` | ID of parent shape (for bound text) |

### Arrow Properties

| Property | Type | Description |
|----------|------|-------------|
| `points` | `[[x,y], ...]` | Waypoints relative to element origin |
| `startArrowhead` | `null`, `"arrow"`, `"triangle"`, `"dot"`, `"bar"`, `"diamond"` | Start decoration |
| `endArrowhead` | same options | End decoration |
| `startBinding` | object or `null` | Connection to start shape |
| `endBinding` | object or `null` | Connection to end shape |
| `elbowed` | boolean | Whether arrow uses right-angle routing |
