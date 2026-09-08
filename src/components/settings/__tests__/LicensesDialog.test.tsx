// @vitest-environment jsdom
/**
 * The notice screen (#949). Most of the licences Notesage ships under require
 * the notice to travel with the distributed copy, so the things worth pinning
 * are that the list actually reaches the screen, that it is the real bundled
 * list rather than a placeholder, and that the full text is reachable.
 */
// Radix ScrollArea measures its viewport with ResizeObserver, which jsdom
// does not implement.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setLocale, t } from "@/lib/i18n";
import { LicensesDialog } from "../LicensesDialog";

afterEach(() => {
  setLocale(null);
});

async function openDialog() {
  render(<LicensesDialog open onOpenChange={() => {}} />);
  // The list is loaded on first open, not imported at module scope.
  await waitFor(() => expect(screen.getByText("foliate-js")).toBeTruthy());
}

describe("LicensesDialog", () => {
  it("lists the components that ship outside any manifest", async () => {
    await openDialog();
    expect(screen.getByText(t("licenses.groupBundled"))).toBeTruthy();
    expect(screen.getByText("zip.js")).toBeTruthy();
  });

  it("shows the full licence text when a component is expanded", async () => {
    const user = userEvent.setup();
    await openDialog();
    await user.click(screen.getByText("foliate-js"));
    await waitFor(() => expect(screen.getByText(/Permission is hereby granted/)).toBeTruthy());
  });

  it("filters by name", async () => {
    const user = userEvent.setup();
    await openDialog();
    await user.type(screen.getByLabelText(t("licenses.searchPlaceholder")), "foliate");
    await waitFor(() => expect(screen.queryByText("zip.js")).toBeNull());
    expect(screen.getByText("foliate-js")).toBeTruthy();
  });

  it("says so when nothing matches, rather than showing an empty panel", async () => {
    const user = userEvent.setup();
    await openDialog();
    await user.type(screen.getByLabelText(t("licenses.searchPlaceholder")), "zzzznotathing");
    await waitFor(() => expect(screen.getByText(t("licenses.noMatches"))).toBeTruthy());
  });

  it("speaks the UI language", async () => {
    setLocale("sv");
    await openDialog();
    const heading = screen.getAllByText(t("licenses.title"))[0];
    expect(within(heading).queryByText("Open source projects")).toBeNull();
    expect(t("licenses.title")).toBe("Öppen källkod");
  });
});
