// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlainTextViewer } from "../PlainTextViewer";

// Mock CodeEditor to avoid full CodeMirror setup in jsdom
vi.mock("../CodeEditor", () => ({
  CodeEditor: ({ fileName, content }: { fileName: string; content: string }) => (
    <div data-testid="code-editor" data-filename={fileName}>
      {content}
    </div>
  ),
}));

describe("PlainTextViewer", () => {
  it("renders plain text in <pre> for .txt files", () => {
    render(
      <PlainTextViewer content="Hello, world!" fileName="readme.txt" />
    );
    expect(screen.getByText("Hello, world!")).toBeTruthy();
    expect(screen.getByText("readme.txt")).toBeTruthy();
  });

  it("renders plain text in <pre> for .log files", () => {
    render(
      <PlainTextViewer content="log entry" fileName="debug.log" />
    );
    expect(screen.getByText("log entry")).toBeTruthy();
  });

  it("renders CodeEditor for .ts files when all props provided", () => {
    render(
      <PlainTextViewer
        content="const x = 1;"
        fileName="main.ts"
        filePath="/path/main.ts"
        tabId="tab-1"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const codeEditor = screen.getByTestId("code-editor");
    expect(codeEditor).toBeTruthy();
    expect(codeEditor.getAttribute("data-filename")).toBe("main.ts");
  });

  it("renders CodeEditor for .py files when all props provided", () => {
    render(
      <PlainTextViewer
        content="print('hello')"
        fileName="script.py"
        filePath="/path/script.py"
        tabId="tab-2"
        isDirty={true}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(screen.getByTestId("code-editor")).toBeTruthy();
  });

  it("falls back to plain text for code files when editing props missing", () => {
    render(
      <PlainTextViewer content="const x = 1;" fileName="main.ts" />
    );
    // Should render as plain text since save/edit props are not provided
    expect(screen.queryByTestId("code-editor")).toBeNull();
    expect(screen.getByText("const x = 1;")).toBeTruthy();
  });

  it("renders plain text for extensionless files", () => {
    render(
      <PlainTextViewer content="some content" fileName="Makefile" />
    );
    expect(screen.queryByTestId("code-editor")).toBeNull();
    expect(screen.getByText("some content")).toBeTruthy();
  });
});
