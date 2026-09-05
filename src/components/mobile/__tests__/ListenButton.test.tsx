// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/component-harness";
import { ListenButton } from "@/components/mobile/ListenButton";
import { useMobileStore } from "@/stores/mobile-store";

const toggle = vi.fn();
vi.mock("@/lib/speech-controller", () => ({
  toggleSpeech: (...args: unknown[]) => toggle(...args),
}));

const entry = { path: "Inbox/q3.html", name: "q3.html" };

describe("ListenButton (read aloud from the list, #833)", () => {
  beforeEach(() => {
    toggle.mockReset();
    useMobileStore.setState({ speech: null });
  });

  it("idle: headphones, no ring; a tap hands the entry to the controller", () => {
    renderWithProviders(<ListenButton entry={entry} size="row" />);
    const button = screen.getByRole("button", { name: "Listen" });
    expect(button.getAttribute("data-state")).toBe("idle");
    expect(screen.queryByTestId("listen-ring")).toBeNull();
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledWith(entry);
  });

  it("playing this document: Pause with the ring filled to the paragraph read", () => {
    useMobileStore.setState({
      speech: { relPath: entry.path, title: "Q3", playing: true, index: 3, total: 12, rate: 1, language: "en" },
    });
    renderWithProviders(<ListenButton entry={entry} size="row" />);
    const button = screen.getByRole("button", { name: "Pause" });
    expect(button.getAttribute("data-state")).toBe("playing");
    const ring = screen.getByTestId("listen-ring");
    const dash = Number(ring.getAttribute("stroke-dasharray"));
    const offset = Number(ring.getAttribute("stroke-dashoffset"));
    expect(offset / dash).toBeCloseTo(1 - 4 / 12, 5);
  });

  it("paused: Play, ring kept; another document's session leaves this one idle", () => {
    useMobileStore.setState({
      speech: { relPath: entry.path, title: "Q3", playing: false, index: 6, total: 12, rate: 1, language: "en" },
    });
    const { unmount } = renderWithProviders(<ListenButton entry={entry} size="card" />);
    expect(screen.getByRole("button", { name: "Play" }).getAttribute("data-state")).toBe("paused");
    expect(screen.getByTestId("listen-ring")).toBeTruthy();
    unmount();
    renderWithProviders(<ListenButton entry={{ path: "Inbox/other.html", name: "other.html" }} size="card" />);
    expect(screen.getByRole("button", { name: "Listen" }).getAttribute("data-state")).toBe("idle");
  });
});

describe("while a recording runs", () => {
  it("the Listen control is disabled and says why — one owner of the audio session", async () => {
    const { renderWithProviders, screen } = await import("@/test/component-harness");
    useMobileStore.setState({ recording: { ...useMobileStore.getState().recording, status: "recording" } });
    renderWithProviders(<ListenButton entry={{ name: "a.html", path: "a.html" }} size="row" />);
    const button = screen.getByRole("button", { name: "Recording in progress" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
