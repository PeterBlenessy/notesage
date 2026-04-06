# Simple Flowchart (Start → Process → End)

**Markdown:** `![drawing](/.notesage/drawings/flowchart-example.excalidraw)`

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
