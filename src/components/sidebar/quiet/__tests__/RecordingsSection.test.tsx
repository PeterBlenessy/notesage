// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, renderWithProviders, screen, waitFor } from "@/test/component-harness";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { RecordingsSection } from "@/components/sidebar/quiet/RecordingsSection";
import { useRecordingsStore } from "@/stores/recordings-store";
import { useInboxStore } from "@/stores/inbox-store";
import { useSettingsStore } from "@/stores/settings-store";
import { serializeRecordingManifest } from "@/lib/transcription/manifest";

const DIR = "/Users/peter/Notesage/Recordings";

function manifest(over: Partial<Parameters<typeof serializeRecordingManifest>[0]> = {}) {
  return serializeRecordingManifest({
    version: 1,
    createdBy: { device: "Peter's iPhone", app: "notesage-ios", appVersion: "0.53.0" },
    startedAt: "2026-09-05T12:04:00+02:00",
    durationSecs: 480,
    source: "microphone",
    audio: { file: "audio.m4a", bytes: 1024, codec: "aac", sampleRate: 48000, channels: 1 },
    transcription: null,
    ...over,
  } as Parameters<typeof serializeRecordingManifest>[0]);
}

describe("RecordingsSection (sidebar row)", () => {
  beforeEach(() => {
    useRecordingsStore.setState({ open: false, dir: null, bundles: [] });
    useInboxStore.setState({ open: false });
    useSettingsStore.setState({ notesRootPath: "~/Notesage", homeDir: "/Users/peter" });
    setMockInvokeHandler("list_files_shallow", () => []);
    setMockInvokeHandler("read_file", () => {
      throw new Error("no manifest");
    });
    setMockInvokeHandler("path_exists", () => false);
  });

  it("shows the row for an empty Recordings folder — it is a place, not a list", async () => {
    // The whole point of the change: Recordings had NO desktop surface at all,
    // so a bundle that failed to transcribe was unreachable in the app
    // (Peter, 2026-09-07).
    renderWithProviders(<RecordingsSection />);
    const row = await screen.findByTestId("recordings-row");
    expect(row.textContent).toContain("Recordings");
    expect(screen.queryByTestId("recordings-failed")).toBeNull();
  });

  it("stays hidden only while the home directory is unknown", () => {
    useSettingsStore.setState({ homeDir: null, notesRootPath: undefined, icloudNotesagePath: undefined });
    renderWithProviders(<RecordingsSection />);
    expect(screen.queryByTestId("recordings-row")).toBeNull();
  });

  it("badges the bundles that failed, because those are the ones wanting a decision", async () => {
    // Not a count of all recordings: they transcribe and file themselves, so a
    // standing total would never reach zero and would never mean anything.
    setMockInvokeHandler("list_files_shallow", () => [
      { name: "Recording 2026-09-05 12-04-00", path: `${DIR}/Recording 2026-09-05 12-04-00`, is_directory: true, hidden: false },
      { name: "Recording 2026-09-06 09-00-00", path: `${DIR}/Recording 2026-09-06 09-00-00`, is_directory: true, hidden: false },
    ]);
    setMockInvokeHandler("read_file", (args) =>
      String(args?.path ?? "").includes("2026-09-05")
        ? manifest({
            transcription: {
              status: "failed",
              device: "Peter's Mac",
              updatedAt: "2026-09-05T12:20:00+02:00",
              error: "Whisper model not found",
            },
          })
        : manifest(),
    );

    renderWithProviders(<RecordingsSection />);
    const badge = await screen.findByTestId("recordings-failed");
    expect(badge.textContent).toBe("1");
  });

  it("opening it closes the Inbox — one document column, one mode", async () => {
    useInboxStore.setState({ open: true });
    renderWithProviders(<RecordingsSection />);
    const row = await screen.findByTestId("recordings-row");
    fireEvent.click(row);
    await waitFor(() => expect(useRecordingsStore.getState().open).toBe(true));
    expect(useInboxStore.getState().open).toBe(false);
  });

  it("and opening the Inbox closes it, whichever caller opened the Inbox", async () => {
    // ⌘⇧I and a notification tap both call `openInbox` directly, so the rule
    // cannot live in the sidebar row.
    renderWithProviders(<RecordingsSection />);
    await screen.findByTestId("recordings-row");
    useRecordingsStore.setState({ open: true });
    useInboxStore.getState().openInbox();
    expect(useRecordingsStore.getState().open).toBe(false);
  });
});
