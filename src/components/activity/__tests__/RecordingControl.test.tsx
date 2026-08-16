// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/component-harness";
import { RecordingControl } from "@/components/activity/RecordingControl";

const toggleRecording = vi.fn(async () => {});
let state = { isRecording: false, isPaused: false, elapsedTime: 0 };

vi.mock("@/hooks/useMeetingRecording", () => ({
  useMeetingRecording: () => ({ toggleRecording, ...state }),
}));

beforeEach(() => {
  toggleRecording.mockClear();
  state = { isRecording: false, isPaused: false, elapsedTime: 0 };
});

/**
 * The control that replaces the status-tray microphone orphaned by the
 * sidebar migration (#696). Its whole point is being reachable, so the tests
 * are about reachability and state, not styling.
 */
describe("RecordingControl", () => {
  it("offers to start when idle, and teaches the shortcut", () => {
    renderWithProviders(<RecordingControl />);
    const button = screen.getByRole("button", { name: "Start recording" });
    expect(button.getAttribute("title")).toContain("⌘⇧R");
  });

  it("starts a recording on click", () => {
    renderWithProviders(<RecordingControl />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(toggleRecording).toHaveBeenCalledTimes(1);
  });

  it("becomes a stop control showing elapsed time while recording", () => {
    state = { isRecording: true, isPaused: false, elapsedTime: 75 };
    renderWithProviders(<RecordingControl />);
    const button = screen.getByRole("button", { name: "Stop recording" });
    expect(button.textContent).toContain("01:15");
    fireEvent.click(button);
    expect(toggleRecording).toHaveBeenCalledTimes(1);
  });

  it("switches to h:mm:ss past an hour", () => {
    state = { isRecording: true, isPaused: false, elapsedTime: 3725 };
    renderWithProviders(<RecordingControl />);
    expect(screen.getByRole("button", { name: "Stop recording" }).textContent).toContain(
      "1:02:05",
    );
  });
});
