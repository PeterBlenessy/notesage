/**
 * Converts Mermaid diagram syntax to Excalidraw scene data
 * using @excalidraw/mermaid-to-excalidraw.
 *
 * Returns a JSON string suitable for the drawing node's `drawingJson` attribute.
 */
export async function convertMermaidToExcalidraw(
  mermaidSource: string,
): Promise<string> {
  const { parseMermaidToExcalidraw } = await import(
    "@excalidraw/mermaid-to-excalidraw"
  );

  const { elements, files } = await parseMermaidToExcalidraw(mermaidSource);

  const sceneData = {
    type: "excalidraw",
    version: 2,
    elements,
    appState: {
      viewBackgroundColor: "transparent",
    },
    files: files ?? {},
  };

  return JSON.stringify(sceneData);
}
