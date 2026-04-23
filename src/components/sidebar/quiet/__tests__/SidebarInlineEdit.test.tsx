// @vitest-environment jsdom

import "@/test/tauri-mock";
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test/component-harness";
import userEvent from "@testing-library/user-event";

import { SidebarInlineEdit } from "../SidebarInlineEdit";

function getInput() {
  const input = screen.getByLabelText(/rename|create/i);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("SidebarInlineEdit input not found");
  }
  return input;
}

describe("SidebarInlineEdit", () => {
  it("rename mode: renders initial value, selects text on mount, Enter commits unchanged value", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    renderWithProviders(
      <SidebarInlineEdit
        mode="rename"
        initialValue="original"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    const input = getInput();
    expect(input.value).toBe("original");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("original".length);

    await user.keyboard("{Enter}");

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("original");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("rename mode: Enter with new value commits the new value", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    renderWithProviders(
      <SidebarInlineEdit
        mode="rename"
        initialValue="original"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    const input = getInput();
    await user.clear(input);
    await user.type(input, "new value");
    await user.keyboard("{Enter}");

    expect(onCommit).toHaveBeenCalledWith("new value");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("rename mode: Enter with whitespace-only value cancels instead of committing", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    renderWithProviders(
      <SidebarInlineEdit
        mode="rename"
        initialValue="original"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    const input = getInput();
    await user.clear(input);
    await user.type(input, "   ");
    await user.keyboard("{Enter}");

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("rename mode: Escape cancels without committing", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    renderWithProviders(
      <SidebarInlineEdit
        mode="rename"
        initialValue="original"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("create mode: renders empty input, Enter with value commits", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    renderWithProviders(
      <SidebarInlineEdit
        mode="create"
        placeholder="New note"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    const input = getInput();
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("New note");

    await user.type(input, "notes.md");
    await user.keyboard("{Enter}");

    expect(onCommit).toHaveBeenCalledWith("notes.md");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("create mode: Escape cancels without committing", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    renderWithProviders(
      <SidebarInlineEdit
        mode="create"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("validate: rejection keeps the input open and renders an alert", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const validate = (value: string) =>
      value === "bad" ? "Name already exists" : null;

    renderWithProviders(
      <SidebarInlineEdit
        mode="create"
        validate={validate}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    const input = getInput();
    await user.type(input, "bad");
    await user.keyboard("{Enter}");

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Name already exists");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    await user.clear(input);
    await user.type(input, "good");
    await user.keyboard("{Enter}");

    expect(onCommit).toHaveBeenCalledWith("good");
  });

  it("IME composition: Enter during composition does not commit or cancel", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    renderWithProviders(
      <SidebarInlineEdit
        mode="rename"
        initialValue="original"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    const input = getInput();

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("blur: triggers cancel, not commit", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    renderWithProviders(
      <SidebarInlineEdit
        mode="rename"
        initialValue="original"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    const input = getInput();
    fireEvent.blur(input);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
