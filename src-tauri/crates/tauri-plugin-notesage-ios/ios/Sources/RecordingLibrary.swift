import Foundation
import UIKit

/// The recorder's way into the library. A separate file, not part of
/// `LibraryAccess.swift`, because that file is also compiled into the Share
/// Extension, which has no recorder.
extension LibraryAccess {
    /// Move a finished recording into the library: `Recordings/Recording
    /// <stamp>/` with the audio copied under coordination and a manifest the
    /// Mac reads and annotates. The staging folder goes only after both
    /// writes succeeded. Returns the bundle's rel path and the manifest JSON.
    static func finalizeRecording(_ staged: Recorder.Staged) throws -> (String, String) {
        let root = try resolveRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let recordings = root.appendingPathComponent("Recordings", isDirectory: true)
        if !FileManager.default.fileExists(atPath: recordings.path) {
            var coordError: NSError?
            NSFileCoordinator().coordinate(writingItemAt: recordings, options: [], error: &coordError) { url in
                try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            }
            if let coordError { throw coordError }
        }
        // The same stamp the Mac writes (`transcription.rs`), local time.
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH-mm-ss"
        let stamp = "Recording \(f.string(from: staged.startedAt))"
        let (bundle, rel) = deduped("Recordings/\(stamp)", under: root)
        var coordError: NSError?
        var failure: Error?
        NSFileCoordinator().coordinate(writingItemAt: bundle, options: [], error: &coordError) { url in
            do {
                try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
                try FileManager.default.copyItem(at: staged.audio, to: url.appendingPathComponent("audio.m4a"))
            } catch { failure = error }
        }
        if let coordError { throw coordError }
        if let failure { throw failure }
        let audio = bundle.appendingPathComponent("audio.m4a")
        let bytes = (try? FileManager.default.attributesOfItem(atPath: audio.path)[.size] as? Int) ?? staged.bytes
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        let manifest = RecordingManifest(
            version: 1,
            createdBy: .init(device: DeviceLabel.current, app: "notesage-ios", appVersion: version),
            startedAt: RecordingManifest.iso8601(staged.startedAt),
            durationSecs: (staged.durationSecs * 10).rounded() / 10,
            source: "microphone",
            language: staged.language,
            audio: .init(file: "audio.m4a", bytes: bytes, codec: "aac", sampleRate: Recorder.sampleRate, channels: 1, bitrate: Recorder.bitrate),
            transcription: nil)
        let json = try manifest.json()
        let manifestURL = bundle.appendingPathComponent(RecordingManifest.fileName)
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: manifestURL, options: .forReplacing, error: &coordError) { url in
            do { try json.write(to: url) } catch { writeError = error }
        }
        if let coordError { throw coordError }
        if let writeError { throw writeError }
        try? FileManager.default.removeItem(at: staged.dir)
        return (rel, String(decoding: json, as: UTF8.self))
    }
}

/// What this phone calls itself, for a manifest's `createdBy.device` and the
/// Mac's "from Peter's iPhone" caption on the transcription card.
///
/// `UIDevice.current.name` is the only source there is, and since iOS 16 it
/// returns the MODEL name ("iPhone") rather than the user-assigned one unless
/// the app carries the user-assigned-device-name entitlement — which needs a
/// use case Apple accepts, and a nicer caption is not one.
///
/// The plan was to borrow the label the Inbox reading-progress sidecar
/// writes. The sidecar's format has the field, but nothing on the phone has
/// ever populated it, so there was nothing to borrow. The caption therefore
/// degrades to "from iPhone" — which still carries the part that matters:
/// this recording arrived from the phone, it was not made on this Mac.
///
/// One accessor so the day a real name becomes available (an entitlement, or
/// a name the user types into the app), it is one edit and both surfaces
/// follow.
enum DeviceLabel {
    static var current: String {
        let name = UIDevice.current.name.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? UIDevice.current.model : name
    }
}
