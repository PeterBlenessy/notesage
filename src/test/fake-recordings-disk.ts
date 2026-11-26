/**
 * An in-memory folder tree behind the Tauri mock, for tests of the Recordings
 * place: enough of the file commands (and the transcription ones) that the
 * real store, scanner and job hook can run against it unmocked.
 *
 * Every call is recorded, so a test can pin HOW MANY calls something cost,
 * which is what several of the findings were about.
 */
import { setMockInvokeHandler } from "@/test/tauri-mock";
import {
  serializeRecordingManifest,
  type RecordingManifest,
} from "@/lib/transcription/manifest";
import type { TranscriptionResult } from "@/lib/tauri";

export interface FakeEntry {
  name: string;
  path: string;
  is_directory: boolean;
  hidden: boolean;
  children?: FakeEntry[];
  truncated?: boolean;
}

export interface FakeDisk {
  /** path → text content. A file exists when it has an entry. */
  files: Map<string, string>;
  /** Directories that exist with nothing in them. */
  dirs: Set<string>;
  /** Byte sizes for files whose content is a stand-in (audio). */
  sizes: Map<string, number>;
  /** Files that exist in name only (iCloud "dataless"). */
  notLocal: Set<string>;
  calls: Array<{ cmd: string; args: Record<string, unknown> }>;
  count: (cmd: string, match?: (args: Record<string, unknown>) => boolean) => number;
  /** What `open_file_dialog` returns next. */
  pick: string | null;
  /** What `transcribe_file` does. Replace it to defer, fail or inspect. */
  transcribe: (args: Record<string, unknown>) => TranscriptionResult | Promise<TranscriptionResult>;
  device: string;
  resetCalls: () => void;
}

export const RECORDINGS_DIR = "/Users/peter/Notesage/Recordings";

export function manifestFor(over: Partial<RecordingManifest> = {}): RecordingManifest {
  return {
    version: 1,
    createdBy: { device: "This Mac", app: "notesage-macos", appVersion: "0.64.0" },
    startedAt: "2026-09-05T14:02:11+02:00",
    durationSecs: 4503,
    source: "microphone",
    audio: { file: "audio.m4a", bytes: 34_000_000, codec: "aac", sampleRate: 48000, channels: 1 },
    transcription: null,
    ...over,
  };
}

/** Put a bundle on the disk. Returns its folder path. */
export function addBundle(
  disk: FakeDisk,
  name: string,
  options: {
    manifest?: Partial<RecordingManifest> | null;
    files?: Record<string, string>;
    audio?: string | null;
  } = {},
): string {
  const dir = `${RECORDINGS_DIR}/${name}`;
  disk.dirs.add(dir);
  const manifest = options.manifest === null ? null : manifestFor(options.manifest ?? {});
  if (manifest) disk.files.set(`${dir}/recording.json`, serializeRecordingManifest(manifest));
  const audio = options.audio === undefined ? (manifest?.audio.file ?? "audio.m4a") : options.audio;
  if (audio) {
    disk.files.set(`${dir}/${audio}`, "<audio>");
    disk.sizes.set(`${dir}/${audio}`, manifest?.audio.bytes ?? 1024);
  }
  for (const [file, content] of Object.entries(options.files ?? {})) disk.files.set(`${dir}/${file}`, content);
  return dir;
}

export function installFakeDisk(): FakeDisk {
  const disk: FakeDisk = {
    files: new Map(),
    dirs: new Set([RECORDINGS_DIR]),
    sizes: new Map(),
    notLocal: new Set(),
    calls: [],
    count: (cmd, match) => disk.calls.filter((c) => c.cmd === cmd && (!match || match(c.args))).length,
    pick: null,
    transcribe: () => ({
      segments: [
        { start: 0, end: 4, text: "Hello and welcome.", speaker: null },
        { start: 4.5, end: 9, text: "Let us begin.", speaker: null },
      ],
      duration_secs: 9,
      language: "en",
      decoder: "mock",
    }),
    device: "This Mac",
    resetCalls: () => {
      disk.calls.length = 0;
    },
  };

  const isDir = (path: string) =>
    disk.dirs.has(path) || [...disk.files.keys(), ...disk.dirs].some((p) => p.startsWith(`${path}/`));

  const list = (path: string, depth: number, maxDepth: number): FakeEntry[] => {
    const names = new Set<string>();
    for (const p of [...disk.files.keys(), ...disk.dirs]) {
      if (p.startsWith(`${path}/`)) names.add(p.slice(path.length + 1).split("/")[0]);
    }
    return [...names]
      .filter((name) => !name.startsWith("."))
      .sort()
      .map((name) => {
        const full = `${path}/${name}`;
        const directory = !disk.files.has(full);
        const entry: FakeEntry = { name, path: full, is_directory: directory, hidden: false };
        if (directory) {
          if (depth < maxDepth) entry.children = list(full, depth + 1, maxDepth);
          else {
            entry.children = [];
            entry.truncated = true;
          }
        }
        return entry;
      });
  };

  const on = (cmd: string, handler: (args: Record<string, unknown>) => unknown) =>
    setMockInvokeHandler(cmd, (args) => {
      const a = args ?? {};
      disk.calls.push({ cmd, args: a });
      return handler(a);
    });

  on("list_directory", (a) => {
    const path = String(a.path);
    if (!isDir(path)) throw new Error(`Path is not a directory: ${path}`);
    return list(path, 0, typeof a.maxDepth === "number" ? a.maxDepth : 50);
  });
  on("list_files_shallow", () => []);
  on("read_file", (a) => {
    const content = disk.files.get(String(a.path));
    if (content === undefined) throw new Error(`Failed to read file ${String(a.path)}: No such file`);
    return content;
  });
  on("read_binary_file", (a) => {
    const content = disk.files.get(String(a.path));
    if (content === undefined) throw new Error(`Failed to read file ${String(a.path)}: No such file`);
    return [...new TextEncoder().encode(content)];
  });
  on("write_file", (a) => {
    disk.files.set(String(a.path), String(a.content));
    return undefined;
  });
  on("path_exists", (a) => disk.files.has(String(a.path)) || isDir(String(a.path)));
  on("file_size", (a) => {
    const path = String(a.path);
    if (!disk.files.has(path)) throw new Error(`Failed to stat ${path}`);
    return disk.sizes.get(path) ?? disk.files.get(path)!.length;
  });
  on("audio_file_status", (a) => {
    const path = String(a.path);
    const exists = disk.files.has(path);
    return {
      exists,
      size: exists ? (disk.sizes.get(path) ?? disk.files.get(path)!.length) : 0,
      local: exists && !disk.notLocal.has(path),
    };
  });
  on("icloud_ensure_downloaded", (a) => (disk.notLocal.has(String(a.path)) ? "downloading" : "ready"));
  on("get_device_name", () => disk.device);
  on("reveal_in_finder", () => undefined);
  on("open_file_dialog", () => disk.pick);
  const movePrefix = (from: string, to: string, keep: boolean) => {
    for (const [p, content] of [...disk.files]) {
      if (p === from || p.startsWith(`${from}/`)) {
        disk.files.set(to + p.slice(from.length), content);
        const size = disk.sizes.get(p);
        if (size !== undefined) disk.sizes.set(to + p.slice(from.length), size);
        if (!keep) {
          disk.files.delete(p);
          disk.sizes.delete(p);
        }
      }
    }
    if (disk.dirs.has(from)) {
      disk.dirs.add(to);
      if (!keep) disk.dirs.delete(from);
    }
  };
  const removePrefix = (path: string) => {
    for (const p of [...disk.files.keys()]) if (p === path || p.startsWith(`${path}/`)) disk.files.delete(p);
    for (const p of [...disk.dirs]) if (p === path || p.startsWith(`${path}/`)) disk.dirs.delete(p);
  };
  on("rename_path", (a) => {
    movePrefix(String(a.oldPath), String(a.newPath), false);
    return undefined;
  });
  on("copy_directory", (a) => {
    movePrefix(String(a.source), String(a.destination), true);
    return undefined;
  });
  on("copy_file", (a) => {
    const content = disk.files.get(String(a.source));
    if (content === undefined) throw new Error(`Source file does not exist: ${String(a.source)}`);
    disk.files.set(String(a.destination), content);
    return undefined;
  });
  on("delete_path", (a) => {
    removePrefix(String(a.path));
    return undefined;
  });
  on("trash_path", (a) => {
    removePrefix(String(a.path));
    return undefined;
  });
  on("transcribe_file", (a) => disk.transcribe(a));
  on("cancel_transcription", () => true);
  on("import_media", (a) => {
    const source = String(a.sourcePath);
    const name = source.slice(source.lastIndexOf("/") + 1);
    const dir = `${String(a.destRecordingsDir)}/Import ${name.replace(/\.[^.]+$/, "")} 2026-11-25 101500`;
    disk.dirs.add(dir);
    disk.files.set(`${dir}/audio.m4a`, "<audio>");
    disk.sizes.set(`${dir}/audio.m4a`, 2_400_000);
    return { bundle_dir: dir, audio_path: `${dir}/audio.m4a`, duration_secs: 95, original_name: name };
  });
  on("list_whisper_models", () => []);
  // Things mounted components reach for that are not the subject here.
  on("watch_directory", () => undefined);
  on("mark_self_write", () => undefined);
  on("clear_self_write", () => undefined);
  return disk;
}
