// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { act, render, fireEvent } from "@testing-library/react";
import { ImageHoverControls } from "@/components/editor/ImageHoverControls";

// Regression for #173-image-resize-followup: hover the image, controls
// appear; mouse off, they fade after a grace period; transitions to the
// controls themselves keep them open.
describe("ImageHoverControls", () => {
  function makeEditor() {
    const editorDom = document.createElement("div");
    editorDom.className = "ProseMirror";
    document.body.appendChild(editorDom);

    const img = document.createElement("img");
    img.src = "test.png";
    Object.defineProperty(img, "getBoundingClientRect", {
      value: () => ({
        left: 100,
        top: 100,
        right: 300,
        bottom: 200,
        width: 200,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }),
    });
    editorDom.appendChild(img);

    const fakeNode = {
      type: { name: "image" },
      attrs: { blockWidth: null, align: null, src: "test.png" },
    };
    // Walker mock — returns the image node at depth 1.
    const $pos = {
      depth: 1,
      node: () => fakeNode,
      before: () => 1,
    };

    const onHandlers: Record<string, Array<() => void>> = {};
    const editor = {
      view: {
        dom: editorDom,
        posAtDOM: () => 1,
        dispatch: vi.fn(),
      },
      state: {
        doc: { resolve: () => $pos },
        get tr() {
          return { setNodeMarkup: vi.fn() };
        },
      },
      chain: () => ({
        command: (fn: (ctx: { tr: { setNodeMarkup: () => void } }) => boolean) => {
          fn({ tr: { setNodeMarkup: vi.fn() } });
          return { run: () => {} };
        },
      }),
      on: (event: string, fn: () => void) => {
        (onHandlers[event] ||= []).push(fn);
      },
      off: (event: string, fn: () => void) => {
        onHandlers[event] = (onHandlers[event] || []).filter((f) => f !== fn);
      },
    } as never;

    return { editor, editorDom, img };
  }

  it("renders nothing by default", () => {
    const { editor } = makeEditor();
    const { container } = render(<ImageHoverControls editor={editor} />);
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("shows controls when an <img> in the editor is hovered", () => {
    const { editor, img } = makeEditor();
    render(<ImageHoverControls editor={editor} />);

    act(() => {
      fireEvent.mouseOver(img);
    });

    // 4 width buttons + 3 align buttons = 7
    const buttons = document.querySelectorAll(
      "[data-image-hover-controls] button",
    );
    expect(buttons.length).toBeGreaterThanOrEqual(7);
  });

  it("hides controls after grace period when cursor leaves", async () => {
    vi.useFakeTimers();
    try {
      const { editor, img } = makeEditor();
      render(<ImageHoverControls editor={editor} />);

      act(() => {
        fireEvent.mouseOver(img);
      });
      expect(
        document.querySelectorAll("[data-image-hover-controls]").length,
      ).toBe(1);

      // Mouse leaves to a sibling element (not the controls) → schedule hide.
      const elsewhere = document.createElement("p");
      document.body.appendChild(elsewhere);
      act(() => {
        fireEvent.mouseOut(img, { relatedTarget: elsewhere });
      });

      // Before grace timer elapses, still visible.
      expect(
        document.querySelectorAll("[data-image-hover-controls]").length,
      ).toBe(1);

      // After grace period, hidden.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(
        document.querySelectorAll("[data-image-hover-controls]").length,
      ).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not react to non-image hover events inside the editor", () => {
    const { editor, editorDom } = makeEditor();
    render(<ImageHoverControls editor={editor} />);

    const p = document.createElement("p");
    p.textContent = "regular paragraph";
    editorDom.appendChild(p);

    act(() => {
      fireEvent.mouseOver(p);
    });

    expect(
      document.querySelectorAll("[data-image-hover-controls]").length,
    ).toBe(0);
  });
});
