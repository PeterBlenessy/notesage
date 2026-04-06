# Architecture Diagram (Frontend → API → Database, with Cache)

**Markdown:** `![drawing](/.notesage/drawings/architecture-example.excalidraw)`

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "notesage",
  "elements": [
    {
      "id": "frontend", "type": "rectangle", "x": 50, "y": 100, "width": 140, "height": 60,
      "backgroundColor": "#e3f2fd", "roundness": { "type": 3 },
      "boundElements": [{ "id": "t-fe", "type": "text" }, { "id": "a1", "type": "arrow" }]
    },
    { "id": "t-fe", "type": "text", "x": 50, "y": 100, "width": 140, "height": 60, "text": "Frontend", "originalText": "Frontend", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "frontend", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "api", "type": "rectangle", "x": 280, "y": 100, "width": 140, "height": 60,
      "backgroundColor": "#fff3e0", "roundness": { "type": 3 },
      "boundElements": [{ "id": "t-api", "type": "text" }, { "id": "a1", "type": "arrow" }, { "id": "a2", "type": "arrow" }, { "id": "a3", "type": "arrow" }]
    },
    { "id": "t-api", "type": "text", "x": 280, "y": 100, "width": 140, "height": 60, "text": "API", "originalText": "API", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "api", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "database", "type": "rectangle", "x": 510, "y": 100, "width": 140, "height": 60,
      "backgroundColor": "#e8f5e9", "roundness": { "type": 3 },
      "boundElements": [{ "id": "t-db", "type": "text" }, { "id": "a2", "type": "arrow" }]
    },
    { "id": "t-db", "type": "text", "x": 510, "y": 100, "width": 140, "height": 60, "text": "Database", "originalText": "Database", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "database", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "cache", "type": "rectangle", "x": 280, "y": 240, "width": 140, "height": 60,
      "backgroundColor": "#fce4ec", "roundness": { "type": 3 },
      "boundElements": [{ "id": "t-cache", "type": "text" }, { "id": "a3", "type": "arrow" }]
    },
    { "id": "t-cache", "type": "text", "x": 280, "y": 240, "width": 140, "height": 60, "text": "Cache", "originalText": "Cache", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "cache", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "a1", "type": "arrow", "x": 190, "y": 130, "width": 90, "height": 0,
      "points": [[0, 0], [90, 0]],
      "startBinding": { "elementId": "frontend", "focus": 0, "gap": 1 },
      "endBinding": { "elementId": "api", "focus": 0, "gap": 1 },
      "startArrowhead": null, "endArrowhead": "arrow"
    },
    {
      "id": "a2", "type": "arrow", "x": 420, "y": 130, "width": 90, "height": 0,
      "points": [[0, 0], [90, 0]],
      "startBinding": { "elementId": "api", "focus": 0, "gap": 1 },
      "endBinding": { "elementId": "database", "focus": 0, "gap": 1 },
      "startArrowhead": null, "endArrowhead": "arrow"
    },
    {
      "id": "a3", "type": "arrow", "x": 350, "y": 160, "width": 0, "height": 80,
      "points": [[0, 0], [0, 80]],
      "startBinding": { "elementId": "api", "focus": 0, "gap": 1 },
      "endBinding": { "elementId": "cache", "focus": 0, "gap": 1 },
      "startArrowhead": null, "endArrowhead": "arrow"
    }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" }
}
```
