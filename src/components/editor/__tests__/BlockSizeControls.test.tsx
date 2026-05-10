// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { BlockSizeControls } from "@/components/editor/BlockSizeControls";

describe("BlockSizeControls (#173 follow-up)", () => {
  function makeEditor() {
    const setNodeMarkup = vi.fn().mockReturnThis();
    const command = vi.fn((fn: (ctx: { tr: { setNodeMarkup: typeof setNodeMarkup } }) => boolean) => {
      fn({ tr: { setNodeMarkup } });
      return chain;
    });
    const run = vi.fn();
    const chain: { command: typeof command; run: typeof run } = { command, run };
    const editor = {
      chain: () => chain,
    } as never;
    return { editor, setNodeMarkup, run };
  }

  const fakeNode = { attrs: { chartJson: "{}", height: 300 } } as never;

  it("renders 4 width buttons + 3 alignment buttons", () => {
    const { editor } = makeEditor();
    const { container } = render(
      <BlockSizeControls editor={editor} pos={1} node={fakeNode} blockWidth={null} align={null} />,
    );
    expect(container.querySelectorAll("button").length).toBe(7);
  });

  it("highlights the active width preset", () => {
    const { editor } = makeEditor();
    const { getByLabelText } = render(
      <BlockSizeControls editor={editor} pos={1} node={fakeNode} blockWidth={50} align={null} />,
    );
    const fifty = getByLabelText("50% width") as HTMLButtonElement;
    expect(fifty.className).toContain("bg-background");
  });

  it("highlights the active alignment", () => {
    const { editor } = makeEditor();
    const { getByLabelText } = render(
      <BlockSizeControls editor={editor} pos={1} node={fakeNode} blockWidth={null} align="center" />,
    );
    const center = getByLabelText("Align center") as HTMLButtonElement;
    expect(center.className).toContain("bg-background");
  });

  it("clicking a width preset writes blockWidth via setNodeMarkup", () => {
    const { editor, setNodeMarkup, run } = makeEditor();
    const { getByLabelText } = render(
      <BlockSizeControls editor={editor} pos={42} node={fakeNode} blockWidth={null} align={null} />,
    );
    fireEvent.click(getByLabelText("75% width"));
    // Spread node.attrs and merge blockWidth — chain ends with .run() to commit.
    expect(setNodeMarkup).toHaveBeenCalledWith(
      42,
      undefined,
      expect.objectContaining({ blockWidth: 75, chartJson: "{}", height: 300 }),
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("clicking the active width preset clears it (toggle off)", () => {
    const { editor, setNodeMarkup } = makeEditor();
    const { getByLabelText } = render(
      <BlockSizeControls editor={editor} pos={1} node={fakeNode} blockWidth={75} align={null} />,
    );
    fireEvent.click(getByLabelText("75% width"));
    expect(setNodeMarkup).toHaveBeenCalledWith(
      1,
      undefined,
      expect.objectContaining({ blockWidth: null }),
    );
  });

  it("clicking an alignment writes align via setNodeMarkup", () => {
    const { editor, setNodeMarkup, run } = makeEditor();
    const { getByLabelText } = render(
      <BlockSizeControls editor={editor} pos={5} node={fakeNode} blockWidth={null} align={null} />,
    );
    fireEvent.click(getByLabelText("Align right"));
    expect(setNodeMarkup).toHaveBeenCalledWith(
      5,
      undefined,
      expect.objectContaining({ align: "right" }),
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});
