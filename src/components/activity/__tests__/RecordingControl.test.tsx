// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/component-harness";
import { RecordingControl } from "@/components/activity/RecordingControl";
import { useRecordingStore } from "@/stores/recording-store";

const toggleRecording = vi.fn(async () => {});
let state = { isRecording: false, isPaused: false, elapsedTime: 0, phase: "idle", source: "microphone" };

vi.mock("@/hooks/useMeetingRecording", () => ({
  useMeetingRecording: () => ({ toggleRecording, ...state }),
}));

beforeEach(() => {
  toggleRecording.mockClear();
  state = { isRecording: false, isPaused: false, elapsedTime: 0, phase: "idle", source: "microphone" };
  useRecordingStore.setState({ lastUsedSource: "microphone" });
});

/**
 * The control that replaces the status-tray microphone orphaned by the
 * sidebar migration (#696). Its whole point is being reachable, so the tests
 * are about reachability and state, not styling.
 */
describe("RecordingControl", () => {
  it("is a labelled Record button when idle, saying what it will record (U4, U5)", () => {
    useRecordingStore.setState({ lastUsedSource: "both" });
    renderWithProviders(<RecordingControl />);
    const button = screen.getByRole("button", {
      name: "Start recording (Microphone + system audio)",
    });
    // A word, not a bare 14px glyph.
    expect(button.textContent).toContain("Record");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("starts a recording on click", () => {
    renderWithProviders(<RecordingControl />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording (Microphone)" }));
    expect(toggleRecording).toHaveBeenCalledTimes(1);
  });

  it("becomes a pressed stop control showing the recorded time while recording", () => {
    state = { ...state, isRecording: true, elapsedTime: 75, phase: "recording" };
    renderWithProviders(<RecordingControl />);
    const button = screen.getByRole("button", { name: "Stop and save" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toContain("Stop");
    expect(button.textContent).toContain("01:15");
    fireEvent.click(button);
    expect(toggleRecording).toHaveBeenCalledTimes(1);
  });

  it("switches to h:mm:ss past an hour", () => {
    state = { ...state, isRecording: true, elapsedTime: 3725, phase: "recording" };
    renderWithProviders(<RecordingControl />);
    expect(screen.getByRole("button", { name: "Stop and save" }).textContent).toContain(
      "1:02:05",
    );
  });

  it("says Saving… and cannot be pressed while the audio is being saved", () => {
    state = { ...state, isRecording: false, phase: "stopping" };
    renderWithProviders(<RecordingControl />);
    const button = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(toggleRecording).not.toHaveBeenCalled();
  });

  it("cannot be pressed twice while a recording is starting", () => {
    state = { ...state, phase: "starting" };
    renderWithProviders(<RecordingControl />);
    expect((screen.getByRole("button", { name: "Starting…" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
