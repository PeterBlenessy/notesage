# Process Flow with Decision

Input → Validate → (Valid?) → Yes: Process → Done / No: Error → Retry

**Markdown:** `![drawing](/.notesage/drawings/process-flow-example.excalidraw)`

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "notesage",
  "elements": [
    {
      "id": "input", "type": "rectangle", "x": 150, "y": 50, "width": 120, "height": 50,
      "backgroundColor": "#e3f2fd", "roundness": { "type": 3 },
      "boundElements": [{ "id": "t-input", "type": "text" }, { "id": "a1", "type": "arrow" }]
    },
    { "id": "t-input", "type": "text", "x": 150, "y": 50, "width": 120, "height": 50, "text": "Input", "originalText": "Input", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "input", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "validate", "type": "rectangle", "x": 150, "y": 160, "width": 120, "height": 50,
      "backgroundColor": "#fff3e0",
      "boundElements": [{ "id": "t-validate", "type": "text" }, { "id": "a1", "type": "arrow" }, { "id": "a2", "type": "arrow" }]
    },
    { "id": "t-validate", "type": "text", "x": 150, "y": 160, "width": 120, "height": 50, "text": "Validate", "originalText": "Validate", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "validate", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "decision", "type": "diamond", "x": 150, "y": 270, "width": 120, "height": 80,
      "backgroundColor": "#f3e5f5",
      "boundElements": [{ "id": "t-decision", "type": "text" }, { "id": "a2", "type": "arrow" }, { "id": "a3", "type": "arrow" }, { "id": "a4", "type": "arrow" }]
    },
    { "id": "t-decision", "type": "text", "x": 150, "y": 270, "width": 120, "height": 80, "text": "Valid?", "originalText": "Valid?", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "decision", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "process", "type": "rectangle", "x": 150, "y": 420, "width": 120, "height": 50,
      "backgroundColor": "#e8f5e9",
      "boundElements": [{ "id": "t-process", "type": "text" }, { "id": "a3", "type": "arrow" }, { "id": "a5", "type": "arrow" }]
    },
    { "id": "t-process", "type": "text", "x": 150, "y": 420, "width": 120, "height": 50, "text": "Process", "originalText": "Process", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "process", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "done", "type": "rectangle", "x": 150, "y": 530, "width": 120, "height": 50,
      "backgroundColor": "#e8f5e9", "roundness": { "type": 3 },
      "boundElements": [{ "id": "t-done", "type": "text" }, { "id": "a5", "type": "arrow" }]
    },
    { "id": "t-done", "type": "text", "x": 150, "y": 530, "width": 120, "height": 50, "text": "Done", "originalText": "Done", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "done", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "error", "type": "rectangle", "x": 380, "y": 280, "width": 120, "height": 50,
      "backgroundColor": "#fce4ec",
      "boundElements": [{ "id": "t-error", "type": "text" }, { "id": "a4", "type": "arrow" }]
    },
    { "id": "t-error", "type": "text", "x": 380, "y": 280, "width": 120, "height": 50, "text": "Error", "originalText": "Error", "fontSize": 20, "fontFamily": 2, "textAlign": "center", "verticalAlign": "middle", "containerId": "error", "autoResize": true, "lineHeight": 1.25 },
    {
      "id": "a1", "type": "arrow", "x": 210, "y": 100, "width": 0, "height": 60,
      "points": [[0, 0], [0, 60]],
      "startBinding": { "elementId": "input", "focus": 0, "gap": 1 },
      "endBinding": { "elementId": "validate", "focus": 0, "gap": 1 },
      "startArrowhead": null, "endArrowhead": "arrow"
    },
    {
      "id": "a2", "type": "arrow", "x": 210, "y": 210, "width": 0, "height": 60,
      "points": [[0, 0], [0, 60]],
      "startBinding": { "elementId": "validate", "focus": 0, "gap": 1 },
      "endBinding": { "elementId": "decision", "focus": 0, "gap": 1 },
      "startArrowhead": null, "endArrowhead": "arrow"
    },
    {
      "id": "a3", "type": "arrow", "x": 210, "y": 350, "width": 0, "height": 70,
      "points": [[0, 0], [0, 70]],
      "startBinding": { "elementId": "decision", "focus": 0, "gap": 1 },
      "endBinding": { "elementId": "process", "focus": 0, "gap": 1 },
      "startArrowhead": null, "endArrowhead": "arrow"
    },
    {
      "id": "a4", "type": "arrow", "x": 270, "y": 310, "width": 110, "height": 0,
      "points": [[0, 0], [110, 0]],
      "startBinding": { "elementId": "decision", "focus": 0, "gap": 1 },
      "endBinding": { "elementId": "error", "focus": 0, "gap": 1 },
      "startArrowhead": null, "endArrowhead": "arrow"
    },
    {
      "id": "a5", "type": "arrow", "x": 210, "y": 470, "width": 0, "height": 60,
      "points": [[0, 0], [0, 60]],
      "startBinding": { "elementId": "process", "focus": 0, "gap": 1 },
      "endBinding": { "elementId": "done", "focus": 0, "gap": 1 },
      "startArrowhead": null, "endArrowhead": "arrow"
    }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" }
}
```
