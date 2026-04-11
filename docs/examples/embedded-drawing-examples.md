# Embedded Drawing Examples

Examples of inline Excalidraw drawings using the ```` ```excalidraw ```` fenced code block format. Copy any example directly into a markdown document — the editor renders it as an interactive drawing that can be edited in place.

## Format

Drawings are embedded as Excalidraw scene JSON inside a fenced code block:

```
<div data-drawing-json="{
  &quot;type&quot;: &quot;excalidraw&quot;,
  &quot;version&quot;: 2,
  &quot;elements&quot;: [...],
  &quot;appState&quot;: { &quot;viewBackgroundColor&quot;: &quot;#ffffff&quot; },
  &quot;files&quot;: {}
}" data-type="drawing" class="drawing-block"></div>
```

Click the rendered drawing to open the full Excalidraw editor. Changes save back to the inline JSON automatically.

## Element Types

Excalidraw supports: `rectangle`, `ellipse`, `diamond`, `text`, `line`, `arrow`, `freedraw`, `frame`, and `image`.

---

## 1. Simple Rectangle

![](blob:http://localhost:1420/7143ee8f-981c-42f0-91cc-6b8f18e720ae)

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
      "roundness": {
        "type": 3
      },
      "seed": 1001,
      "version": 2,
      "versionNonce": 1447588640,
      "index": "a0",
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [],
      "updated": 1775915976514,
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

shapes side by side demonstrating the core shape types.

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
      "roundness": {
        "type": 3
      },
      "seed": 1100,
      "version": 2,
      "versionNonce": 617915104,
      "index": "a0",
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [],
      "updated": 1775915639301,
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
      "strokeColor": "#e03131",
      "backgroundColor": "#b2f2bb",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": {
        "type": 2
      },
      "seed": 1200,
      "version": 5,
      "versionNonce": 985907698,
      "index": "a1",
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [],
      "updated": 1775916150666,
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
      "roundness": {
        "type": 2
      },
      "seed": 1300,
      "version": 4,
      "versionNonce": 788700146,
      "index": "a2",
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [],
      "updated": 1775916142297,
      "link": null,
      "locked": false
    },
    {
      "type": "line",
      "version": 1752,
      "versionNonce": 1483494386,
      "isDeleted": false,
      "id": "0jufgCi9gFC2ctjuohbj-",
      "fillStyle": "hachure",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "x": 411.97899175637207,
      "y": 291.37758838126695,
      "strokeColor": "#881fa3",
      "backgroundColor": "#be4bdb",
      "width": 116.42036295658872,
      "height": 103.65107323746608,
      "seed": 1615776480,
      "groupIds": [],
      "strokeSharpness": "sharp",
      "boundElementIds": [],
      "startBinding": null,
      "endBinding": null,
      "points": [
        [
          0,
          0
        ],
        [
          -62.44191743896485,
          19.19929080548739
        ],
        [
          -63.17668831316513,
          79.43840749607878
        ],
        [
          -7.618334228588694,
          103.65107323746608
        ],
        [
          51.963117173367294,
          79.15871076413049
        ],
        [
          53.24367464342358,
          21.28567723840068
        ],
        [
          0,
          0
        ]
      ],
      "lastCommittedPoint": null,
      "startArrowhead": null,
      "endArrowhead": null,
      "index": "a3",
      "frameId": null,
      "roundness": null,
      "boundElements": [],
      "updated": 1775916143089,
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
      "backgroundColor": "#ffec99",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "roundness": {
        "type": 3
      },
      "seed": 1500,
      "version": 3,
      "versionNonce": 25282224,
      "index": "a0",
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        {
          "id": "arrow1",
          "type": "arrow"
        }
      ],
      "updated": 1775800417637,
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
      "roundness": {
        "type": 3
      },
      "seed": 1600,
      "version": 2,
      "versionNonce": 1592439472,
      "index": "a1",
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        {
          "id": "arrow1",
          "type": "arrow"
        }
      ],
      "updated": 1775800411304,
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
      "roundness": {
        "type": 2
      },
      "seed": 1700,
      "version": 2,
      "versionNonce": 1616056400,
      "index": "a2",
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [],
      "updated": 1775800411304,
      "link": null,
      "locked": false,
      "points": [
        [
          0,
          0
        ],
        [
          180,
          0
        ]
      ],
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
      "roundness": {
        "type": 3
      },
      "seed": 3001,
      "version": 1,
      "versionNonce": 4001,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        {
          "id": "fc-text-start",
          "type": "text"
        },
        {
          "id": "fc-arrow1",
          "type": "arrow"
        }
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
      "roundness": {
        "type": 2
      },
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
      "points": [
        [
          0,
          0
        ],
        [
          0,
          40
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "fc-start",
        "focus": 0,
        "gap": 1,
        "fixedPoint": null
      },
      "endBinding": {
        "elementId": "fc-decision",
        "focus": 0,
        "gap": 1,
        "fixedPoint": null
      },
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
      "roundness": {
        "type": 2
      },
      "seed": 3004,
      "version": 1,
      "versionNonce": 4004,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        {
          "id": "fc-text-decision",
          "type": "text"
        },
        {
          "id": "fc-arrow1",
          "type": "arrow"
        },
        {
          "id": "fc-arrow-yes",
          "type": "arrow"
        },
        {
          "id": "fc-arrow-no",
          "type": "arrow"
        }
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
      "roundness": {
        "type": 2
      },
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
      "points": [
        [
          0,
          0
        ],
        [
          75,
          0
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "fc-decision",
        "focus": 0,
        "gap": 1,
        "fixedPoint": null
      },
      "endBinding": {
        "elementId": "fc-yes",
        "focus": 0,
        "gap": 1,
        "fixedPoint": null
      },
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
      "roundness": {
        "type": 3
      },
      "seed": 3007,
      "version": 1,
      "versionNonce": 4007,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        {
          "id": "fc-text-yes",
          "type": "text"
        },
        {
          "id": "fc-arrow-yes",
          "type": "arrow"
        }
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
      "roundness": {
        "type": 2
      },
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
      "points": [
        [
          0,
          0
        ],
        [
          0,
          40
        ]
      ],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "fc-decision",
        "focus": 0,
        "gap": 1,
        "fixedPoint": null
      },
      "endBinding": {
        "elementId": "fc-no",
        "focus": 0,
        "gap": 1,
        "fixedPoint": null
      },
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
      "roundness": {
        "type": 3
      },
      "seed": 3010,
      "version": 1,
      "versionNonce": 4010,
      "index": null,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "boundElements": [
        {
          "id": "fc-text-no",
          "type": "text"
        },
        {
          "id": "fc-arrow-no",
          "type": "arrow"
        }
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
      "roundness": {
        "type": 3
      },
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
      "roundness": {
        "type": 2
      },
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
      "points": [
        [
          0,
          0
        ],
        [
          300,
          0
        ]
      ],
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
      "roundness": {
        "type": 2
      },
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
      "points": [
        [
          0,
          0
        ],
        [
          300,
          0
        ]
      ],
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
      "roundness": {
        "type": 2
      },
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
      "points": [
        [
          0,
          0
        ],
        [
          300,
          0
        ]
      ],
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
      "roundness": {
        "type": 3
      },
      "seed": 9001,
      "version": 1,
      "versionNonce": 9101,
      "index": null,
      "isDeleted": false,
      "groupIds": [
        "group-card"
      ],
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
      "groupIds": [
        "group-card"
      ],
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
      "groupIds": [
        "group-card"
      ],
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
| --- | --- | --- |
| `strokeColor` | hex string | Outline color (e.g. `"#1e1e1e"`) |
| `backgroundColor` | hex or `"transparent"` | Fill color |
| `fillStyle` | `"solid"`, `"hachure"`, `"cross-hatch"`, `"zigzag"` | Fill pattern |
| `strokeWidth` | number | Line thickness (1-4) |
| `strokeStyle` | `"solid"`, `"dashed"`, `"dotted"` | Outline style |
| `roughness` | number | 0 = architect, 1 = artist, 2 = cartoonist |
| `opacity` | number | 0-100 |
| `roundness` | `null` or `{ "type": 3 }` | Rounded corners (type 3 for shapes, type 2 for lines) |
| `angle` | number | Rotation in radians |
| `groupIds` | string\[\] | Group membership (elements with same ID move together) |

### Text Properties

| Property | Type | Description |
| --- | --- | --- |
| `text` | string | Display text (use `\n` for newlines) |
| `fontSize` | number | Font size in pixels |
| `fontFamily` | number | 1 = Excalifont (hand-drawn), 2 = Nunito, 3 = Cascadia (mono) |
| `textAlign` | `"left"`, `"center"`, `"right"` | Horizontal alignment |
| `verticalAlign` | `"top"`, `"middle"`, `"bottom"` | Vertical alignment |
| `containerId` | string or `null` | ID of parent shape (for bound text) |

### Arrow Properties

| Property | Type | Description |
| --- | --- | --- |
| `points` | `[[x,y], ...]` | Waypoints relative to element origin |
| `startArrowhead` | `null`, `"arrow"`, `"triangle"`, `"dot"`, `"bar"`, `"diamond"` | Start decoration |
| `endArrowhead` | same options | End decoration |
| `startBinding` | object or `null` | Connection to start shape |
| `endBinding` | object or `null` | Connection to end shape |
| `elbowed` | boolean | Whether arrow uses right-angle routing |

---

## 9. Network Diagram — Three-Tier Architecture

A web architecture diagram with client, server, and database layers connected by arrows.

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "net-client", "type": "rectangle", "x": 150, "y": 30, "width": 160, "height": 60,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#a5d8ff", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 3 }, "seed": 9001, "version": 1, "versionNonce": 9101,
      "index": "a0", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [{ "id": "net-text-client", "type": "text" }, { "id": "net-arrow1", "type": "arrow" }],
      "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "net-text-client", "type": "text", "x": 185, "y": 42, "width": 90, "height": 25,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 9002, "version": 1, "versionNonce": 9102,
      "index": "a1", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "Browser", "fontSize": 20, "fontFamily": 1, "textAlign": "center",
      "verticalAlign": "middle", "containerId": "net-client", "originalText": "Browser", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "net-lb", "type": "ellipse", "x": 165, "y": 150, "width": 130, "height": 60,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#ffec99", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 9003, "version": 1, "versionNonce": 9103,
      "index": "a2", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [{ "id": "net-text-lb", "type": "text" }, { "id": "net-arrow1", "type": "arrow" }, { "id": "net-arrow2a", "type": "arrow" }, { "id": "net-arrow2b", "type": "arrow" }],
      "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "net-text-lb", "type": "text", "x": 185, "y": 165, "width": 90, "height": 25,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 9004, "version": 1, "versionNonce": 9104,
      "index": "a3", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "Load\nBalancer", "fontSize": 16, "fontFamily": 1, "textAlign": "center",
      "verticalAlign": "middle", "containerId": "net-lb", "originalText": "Load\nBalancer", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "net-api1", "type": "rectangle", "x": 50, "y": 280, "width": 130, "height": 55,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#b2f2bb", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 3 }, "seed": 9005, "version": 1, "versionNonce": 9105,
      "index": "a4", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [{ "id": "net-text-api1", "type": "text" }, { "id": "net-arrow2a", "type": "arrow" }, { "id": "net-arrow3", "type": "arrow" }],
      "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "net-text-api1", "type": "text", "x": 75, "y": 295, "width": 80, "height": 25,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 9006, "version": 1, "versionNonce": 9106,
      "index": "a5", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "API #1", "fontSize": 20, "fontFamily": 1, "textAlign": "center",
      "verticalAlign": "middle", "containerId": "net-api1", "originalText": "API #1", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "net-api2", "type": "rectangle", "x": 280, "y": 280, "width": 130, "height": 55,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#b2f2bb", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 3 }, "seed": 9007, "version": 1, "versionNonce": 9107,
      "index": "a6", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [{ "id": "net-text-api2", "type": "text" }, { "id": "net-arrow2b", "type": "arrow" }, { "id": "net-arrow4", "type": "arrow" }],
      "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "net-text-api2", "type": "text", "x": 305, "y": 295, "width": 80, "height": 25,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 9008, "version": 1, "versionNonce": 9108,
      "index": "a7", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "API #2", "fontSize": 20, "fontFamily": 1, "textAlign": "center",
      "verticalAlign": "middle", "containerId": "net-api2", "originalText": "API #2", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "net-db", "type": "rectangle", "x": 140, "y": 400, "width": 180, "height": 60,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#ffc9c9", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 3 }, "seed": 9009, "version": 1, "versionNonce": 9109,
      "index": "a8", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [{ "id": "net-text-db", "type": "text" }, { "id": "net-arrow3", "type": "arrow" }, { "id": "net-arrow4", "type": "arrow" }],
      "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "net-text-db", "type": "text", "x": 180, "y": 415, "width": 100, "height": 25,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 9010, "version": 1, "versionNonce": 9110,
      "index": "a9", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "PostgreSQL", "fontSize": 20, "fontFamily": 1, "textAlign": "center",
      "verticalAlign": "middle", "containerId": "net-db", "originalText": "PostgreSQL", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "net-arrow1", "type": "arrow", "x": 230, "y": 90, "width": 0, "height": 55,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 9011, "version": 1, "versionNonce": 9111,
      "index": "b0", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "points": [[0, 0], [0, 55]],
      "startBinding": { "elementId": "net-client", "focus": 0, "gap": 1, "fixedPoint": null },
      "endBinding": { "elementId": "net-lb", "focus": 0, "gap": 1, "fixedPoint": null },
      "startArrowhead": null, "endArrowhead": "arrow", "elbowed": false
    },
    {
      "id": "net-arrow2a", "type": "arrow", "x": 200, "y": 210, "width": 80, "height": 65,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 9012, "version": 1, "versionNonce": 9112,
      "index": "b1", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "points": [[0, 0], [-80, 65]],
      "startBinding": { "elementId": "net-lb", "focus": 0, "gap": 1, "fixedPoint": null },
      "endBinding": { "elementId": "net-api1", "focus": 0, "gap": 1, "fixedPoint": null },
      "startArrowhead": null, "endArrowhead": "arrow", "elbowed": false
    },
    {
      "id": "net-arrow2b", "type": "arrow", "x": 260, "y": 210, "width": 80, "height": 65,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 9013, "version": 1, "versionNonce": 9113,
      "index": "b2", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "points": [[0, 0], [80, 65]],
      "startBinding": { "elementId": "net-lb", "focus": 0, "gap": 1, "fixedPoint": null },
      "endBinding": { "elementId": "net-api2", "focus": 0, "gap": 1, "fixedPoint": null },
      "startArrowhead": null, "endArrowhead": "arrow", "elbowed": false
    },
    {
      "id": "net-arrow3", "type": "arrow", "x": 115, "y": 335, "width": 80, "height": 60,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "dashed", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 9014, "version": 1, "versionNonce": 9114,
      "index": "b3", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "points": [[0, 0], [80, 60]],
      "startBinding": { "elementId": "net-api1", "focus": 0, "gap": 1, "fixedPoint": null },
      "endBinding": { "elementId": "net-db", "focus": 0, "gap": 1, "fixedPoint": null },
      "startArrowhead": null, "endArrowhead": "arrow", "elbowed": false
    },
    {
      "id": "net-arrow4", "type": "arrow", "x": 345, "y": 335, "width": 80, "height": 60,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "dashed", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 9015, "version": 1, "versionNonce": 9115,
      "index": "b4", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "points": [[0, 0], [-80, 60]],
      "startBinding": { "elementId": "net-api2", "focus": 0, "gap": 1, "fixedPoint": null },
      "endBinding": { "elementId": "net-db", "focus": 0, "gap": 1, "fixedPoint": null },
      "startArrowhead": null, "endArrowhead": "arrow", "elbowed": false
    }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```

---

## 10. State Machine — Traffic Light

A state diagram showing traffic light transitions with colored circles.

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "tl-red", "type": "ellipse", "x": 50, "y": 80, "width": 80, "height": 80,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#ffc9c9", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 10001, "version": 1, "versionNonce": 10101,
      "index": "a0", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [{ "id": "tl-text-red", "type": "text" }, { "id": "tl-arrow1", "type": "arrow" }],
      "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "tl-text-red", "type": "text", "x": 70, "y": 108, "width": 40, "height": 25,
      "angle": 0, "strokeColor": "#c92a2a", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 10002, "version": 1, "versionNonce": 10102,
      "index": "a1", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "Red", "fontSize": 18, "fontFamily": 1, "textAlign": "center",
      "verticalAlign": "middle", "containerId": "tl-red", "originalText": "Red", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "tl-green", "type": "ellipse", "x": 220, "y": 80, "width": 80, "height": 80,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#b2f2bb", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 10003, "version": 1, "versionNonce": 10103,
      "index": "a2", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [{ "id": "tl-text-green", "type": "text" }, { "id": "tl-arrow1", "type": "arrow" }, { "id": "tl-arrow2", "type": "arrow" }],
      "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "tl-text-green", "type": "text", "x": 230, "y": 108, "width": 60, "height": 25,
      "angle": 0, "strokeColor": "#2b8a3e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 10004, "version": 1, "versionNonce": 10104,
      "index": "a3", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "Green", "fontSize": 18, "fontFamily": 1, "textAlign": "center",
      "verticalAlign": "middle", "containerId": "tl-green", "originalText": "Green", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "tl-yellow", "type": "ellipse", "x": 390, "y": 80, "width": 80, "height": 80,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#ffec99", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 10005, "version": 1, "versionNonce": 10105,
      "index": "a4", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [{ "id": "tl-text-yellow", "type": "text" }, { "id": "tl-arrow2", "type": "arrow" }, { "id": "tl-arrow3", "type": "arrow" }],
      "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "tl-text-yellow", "type": "text", "x": 395, "y": 108, "width": 70, "height": 25,
      "angle": 0, "strokeColor": "#e67700", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 10006, "version": 1, "versionNonce": 10106,
      "index": "a5", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "Yellow", "fontSize": 18, "fontFamily": 1, "textAlign": "center",
      "verticalAlign": "middle", "containerId": "tl-yellow", "originalText": "Yellow", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "tl-arrow1", "type": "arrow", "x": 135, "y": 110, "width": 80, "height": 0,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 10007, "version": 1, "versionNonce": 10107,
      "index": "b0", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "points": [[0, 0], [80, 0]],
      "startBinding": { "elementId": "tl-red", "focus": 0, "gap": 1, "fixedPoint": null },
      "endBinding": { "elementId": "tl-green", "focus": 0, "gap": 1, "fixedPoint": null },
      "startArrowhead": null, "endArrowhead": "arrow", "elbowed": false
    },
    {
      "id": "tl-arrow2", "type": "arrow", "x": 305, "y": 110, "width": 80, "height": 0,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 10008, "version": 1, "versionNonce": 10108,
      "index": "b1", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "points": [[0, 0], [80, 0]],
      "startBinding": { "elementId": "tl-green", "focus": 0, "gap": 1, "fixedPoint": null },
      "endBinding": { "elementId": "tl-yellow", "focus": 0, "gap": 1, "fixedPoint": null },
      "startArrowhead": null, "endArrowhead": "arrow", "elbowed": false
    },
    {
      "id": "tl-arrow3", "type": "arrow", "x": 430, "y": 165, "width": 170, "height": 60,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "dashed", "roughness": 1, "opacity": 100,
      "roundness": { "type": 2 }, "seed": 10009, "version": 1, "versionNonce": 10109,
      "index": "b2", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "points": [[0, 0], [0, 60], [-340, 60], [-340, 0]],
      "startBinding": { "elementId": "tl-yellow", "focus": 0, "gap": 1, "fixedPoint": null },
      "endBinding": { "elementId": "tl-red", "focus": 0, "gap": 1, "fixedPoint": null },
      "startArrowhead": null, "endArrowhead": "arrow", "elbowed": false
    }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```

---

## 11. Wireframe — Login Form

A simple UI wireframe sketch with input fields and a button.

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "wf-frame", "type": "rectangle", "x": 80, "y": 30, "width": 300, "height": 380,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": { "type": 3 }, "seed": 11001, "version": 1, "versionNonce": 11101,
      "index": "a0", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [], "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "wf-title", "type": "text", "x": 170, "y": 55, "width": 120, "height": 30,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 11002, "version": 1, "versionNonce": 11102,
      "index": "a1", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "Sign In", "fontSize": 24, "fontFamily": 1, "textAlign": "center",
      "verticalAlign": "top", "containerId": null, "originalText": "Sign In", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "wf-email-label", "type": "text", "x": 110, "y": 110, "width": 60, "height": 20,
      "angle": 0, "strokeColor": "#868e96", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 11003, "version": 1, "versionNonce": 11103,
      "index": "a2", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "Email", "fontSize": 14, "fontFamily": 1, "textAlign": "left",
      "verticalAlign": "top", "containerId": null, "originalText": "Email", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "wf-email-input", "type": "rectangle", "x": 110, "y": 135, "width": 240, "height": 40,
      "angle": 0, "strokeColor": "#ced4da", "backgroundColor": "#f8f9fa", "fillStyle": "solid",
      "strokeWidth": 1, "strokeStyle": "solid", "roughness": 0, "opacity": 100,
      "roundness": { "type": 3 }, "seed": 11004, "version": 1, "versionNonce": 11104,
      "index": "a3", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [], "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "wf-pass-label", "type": "text", "x": 110, "y": 195, "width": 80, "height": 20,
      "angle": 0, "strokeColor": "#868e96", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 11005, "version": 1, "versionNonce": 11105,
      "index": "a4", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "Password", "fontSize": 14, "fontFamily": 1, "textAlign": "left",
      "verticalAlign": "top", "containerId": null, "originalText": "Password", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "wf-pass-input", "type": "rectangle", "x": 110, "y": 220, "width": 240, "height": 40,
      "angle": 0, "strokeColor": "#ced4da", "backgroundColor": "#f8f9fa", "fillStyle": "solid",
      "strokeWidth": 1, "strokeStyle": "solid", "roughness": 0, "opacity": 100,
      "roundness": { "type": 3 }, "seed": 11006, "version": 1, "versionNonce": 11106,
      "index": "a5", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [], "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "wf-btn", "type": "rectangle", "x": 110, "y": 290, "width": 240, "height": 45,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#1e1e1e", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 0, "opacity": 100,
      "roundness": { "type": 3 }, "seed": 11007, "version": 1, "versionNonce": 11107,
      "index": "a6", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": [{ "id": "wf-btn-text", "type": "text" }],
      "updated": 1712700000000, "link": null, "locked": false
    },
    {
      "id": "wf-btn-text", "type": "text", "x": 190, "y": 300, "width": 80, "height": 25,
      "angle": 0, "strokeColor": "#ffffff", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 11008, "version": 1, "versionNonce": 11108,
      "index": "a7", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "Sign In", "fontSize": 18, "fontFamily": 1, "textAlign": "center",
      "verticalAlign": "middle", "containerId": "wf-btn", "originalText": "Sign In", "autoResize": true, "lineHeight": 1.25
    },
    {
      "id": "wf-forgot", "type": "text", "x": 175, "y": 355, "width": 110, "height": 20,
      "angle": 0, "strokeColor": "#868e96", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
      "roundness": null, "seed": 11009, "version": 1, "versionNonce": 11109,
      "index": "a8", "isDeleted": false, "groupIds": [], "frameId": null,
      "boundElements": null, "updated": 1712700000000, "link": null, "locked": false,
      "text": "Forgot password?", "fontSize": 14, "fontFamily": 1, "textAlign": "center",
      "verticalAlign": "top", "containerId": null, "originalText": "Forgot password?", "autoResize": true, "lineHeight": 1.25
    }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```
