import AVFoundation
import Foundation
import UIKit
import os.log

/// The phone's recorder: AAC into the app's own container while it runs,
/// finalised into the library by `LibraryAccess.finalizeRecording` on stop
/// — a file growing for two hours inside iCloud Drive would be re-uploaded
/// repeatedly and be a half-file to the Mac. A singleton, like the speech
/// player, because the audio session is process-wide. Everything that must
/// keep going with the screen locked lives here, natively: the JS timers
/// are suspended then.
final class Recorder: NSObject, AVAudioRecorderDelegate {
    static let shared = Recorder()
    private static let logger = OSLog(subsystem: "com.notesage.app", category: "recording")

    enum State: String { case idle, recording, paused, finalizing }
    enum RecorderError: Error {
        case microphoneDenied
        case notRecording
        case alreadyRecording
        case lowDiskSpace
        case ioError(String)
    }

    struct Staged {
        let dir: URL
        let audio: URL
        let startedAt: Date
        let durationSecs: Double
        let bytes: Int
        let language: String?
    }

    private(set) var state: State = .idle
    private(set) var interrupted = false
    private var recorder: AVAudioRecorder?
    private var stagingDir: URL?
    private var startedAt: Date?
    private var language: String?
    private var tick: Timer?
    private var observersInstalled = false
    /// Native → JS: `notesage:recording` events.
    var onEvent: (([String: Any]) -> Void)?

    static let sampleRate = 48_000
    static let bitrate = 64_000
    static var settings: [String: Any] {
        [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: bitrate,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
    }

    /// `<Application Support>/Recordings/` — the staging area, never synced.
    static var stagingRoot: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Recordings", isDirectory: true)
    }

    static var micPermission: String {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return "granted"
        case .denied: return "denied"
        default: return "unknown"
        }
    }

    // MARK: - Control

    func start(language: String?, completion: @escaping (Result<Void, Error>) -> Void) {
        guard state == .idle else { return completion(.failure(RecorderError.alreadyRecording)) }
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else { return completion(.failure(RecorderError.microphoneDenied)) }
                do {
                    try self.begin(language: language)
                    completion(.success(()))
                } catch {
                    os_log("start failed: %{public}@", log: Recorder.logger, type: .error, String(describing: error))
                    completion(.failure(error))
                }
            }
        }
    }

    private func begin(language: String?) throws {
        // An hour is ~30 MB; refusing at the start beats a truncation at
        // minute ninety.
        if let free = try? Recorder.stagingRoot.deletingLastPathComponent()
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            .volumeAvailableCapacityForImportantUsage, free < 200 * 1024 * 1024
        {
            throw RecorderError.lowDiskSpace
        }
        do {
            try AudioSessionArbiter.shared.claim(
                .recording, category: .playAndRecord, mode: .default,
                options: [.allowBluetooth, .defaultToSpeaker])
        } catch {
            os_log("session claim failed: %{public}@", log: Recorder.logger, type: .error, String(describing: error))
            throw error
        }
        let dir = Recorder.stagingRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("audio.m4a")
        let rec = try AVAudioRecorder(url: url, settings: Recorder.settings)
        rec.delegate = self
        rec.isMeteringEnabled = true
        guard rec.record() else {
            os_log("AVAudioRecorder.record() returned false", log: Recorder.logger, type: .error)
            AudioSessionArbiter.shared.release(.recording)
            throw RecorderError.ioError("the recorder did not start")
        }
        recorder = rec
        stagingDir = dir
        startedAt = Date()
        self.language = language
        interrupted = false
        state = .recording
        installObservers()
        startTick()
        os_log("started %{public}@", log: Recorder.logger, type: .info, dir.lastPathComponent)
        emit(["event": "started"])
    }

    func pause() {
        guard state == .recording, let recorder else { return }
        recorder.pause()
        state = .paused
        emit(["event": "paused"])
    }

    func resume() {
        guard state == .paused, let recorder else { return }
        interrupted = false
        guard recorder.record() else { return }
        state = .recording
        emit(["event": "resumed"])
    }

    /// Stop and hand back what is on disk; the caller finalises it into the
    /// library (or discards a slip of the finger).
    func stop() throws -> Staged {
        guard state == .recording || state == .paused, let recorder, let dir = stagingDir, let startedAt else {
            throw RecorderError.notRecording
        }
        state = .finalizing
        let duration = recorder.currentTime
        recorder.stop()
        stopTick()
        AudioSessionArbiter.shared.release(.recording)
        let url = recorder.url
        let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        self.recorder = nil
        stagingDir = nil
        self.startedAt = nil
        state = .idle
        os_log("stopped after %.1fs, %d bytes", log: Recorder.logger, type: .info, duration, bytes)
        return Staged(dir: dir, audio: url, startedAt: startedAt, durationSecs: duration, bytes: bytes, language: language)
    }

    func stateDictionary() -> [String: Any] {
        var d: [String: Any] = [
            "status": state.rawValue,
            "elapsedSecs": recorder?.currentTime ?? 0,
            "level": currentLevel(),
            "interrupted": interrupted,
            "micPermission": Recorder.micPermission,
        ]
        if state == .idle, let orphan = Recorder.orphans().first {
            d["orphan"] = orphan
        }
        return d
    }

    // MARK: - Orphans (a force-quit mid-recording)

    /// Staging folders left behind, with whether their audio still opens.
    /// `AVAudioRecorder` writes the MP4 `moov` atom at stop, so an
    /// unrecoverable orphan after a force-quit is a real outcome.
    static func orphans() -> [[String: Any]] {
        guard let dirs = try? FileManager.default.contentsOfDirectory(
            at: stagingRoot, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
        else { return [] }
        return dirs.compactMap { dir in
            let audio = dir.appendingPathComponent("audio.m4a")
            guard FileManager.default.fileExists(atPath: audio.path) else { return nil }
            // The one still being written is not an orphan.
            if dir == Recorder.shared.stagingDir { return nil }
            var info: [String: Any] = ["dir": dir.lastPathComponent, "readable": false]
            if let file = try? AVAudioFile(forReading: audio) {
                info["readable"] = true
                info["durationSecs"] = Double(file.length) / file.fileFormat.sampleRate
            }
            let created = (try? FileManager.default.attributesOfItem(atPath: dir.path)[.creationDate] as? Date) ?? Date()
            info["startedAt"] = RecordingManifest.iso8601(created)
            return info
        }
    }

    static func discardOrphan(_ dir: String) {
        try? FileManager.default.removeItem(at: stagingRoot.appendingPathComponent(dir, isDirectory: true))
    }

    static func stagedOrphan(_ dir: String) -> Staged? {
        let folder = stagingRoot.appendingPathComponent(dir, isDirectory: true)
        let audio = folder.appendingPathComponent("audio.m4a")
        guard let file = try? AVAudioFile(forReading: audio) else { return nil }
        let created = (try? FileManager.default.attributesOfItem(atPath: folder.path)[.creationDate] as? Date) ?? Date()
        let bytes = (try? FileManager.default.attributesOfItem(atPath: audio.path)[.size] as? Int) ?? 0
        return Staged(
            dir: folder, audio: audio, startedAt: created,
            durationSecs: Double(file.length) / file.fileFormat.sampleRate, bytes: bytes, language: nil)
    }

    // MARK: - Tick and metering

    private func startTick() {
        stopTick()
        tick = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, let recorder = self.recorder, self.state == .recording else { return }
            self.emit(["event": "tick", "elapsedSecs": recorder.currentTime, "level": self.currentLevel()])
        }
    }

    private func stopTick() {
        tick?.invalidate()
        tick = nil
    }

    /// Metered peak power mapped 0…1 (−60 dB and below is silence).
    private func currentLevel() -> Double {
        guard let recorder, state == .recording else { return 0 }
        recorder.updateMeters()
        let db = Double(recorder.averagePower(forChannel: 0))
        return max(0, min(1, (db + 60) / 60))
    }

    // MARK: - Interruptions and routes

    private func installObservers() {
        guard !observersInstalled else { return }
        observersInstalled = true
        let center = NotificationCenter.default
        center.addObserver(
            forName: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(), queue: .main
        ) { [weak self] note in
            guard let self,
                let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                let type = AVAudioSession.InterruptionType(rawValue: raw)
            else { return }
            switch type {
            case .began:
                // A call. Pause, and say so — the user is told the recording
                // paused rather than left guessing.
                if self.state == .recording {
                    self.pause()
                    self.interrupted = true
                    self.emit(["event": "interrupted", "reason": "began"])
                }
            case .ended:
                let raw = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                if AVAudioSession.InterruptionOptions(rawValue: raw).contains(.shouldResume), self.state == .paused {
                    self.resume()
                } else if self.state == .paused {
                    self.emit(["event": "interrupted", "reason": "ended"])
                }
            @unknown default:
                break
            }
        }
        center.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: AVAudioSession.sharedInstance(), queue: .main
        ) { [weak self] note in
            guard let self,
                let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                let reason = AVAudioSession.RouteChangeReason(rawValue: raw),
                reason == .oldDeviceUnavailable
            else { return }
            // An AirPod taken out: keep going on whatever the new route is
            // (the built-in mic), and let the island say so.
            self.emit(["event": "route", "reason": "oldDeviceUnavailable"])
        }
        center.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self, self.state != .idle else { return }
            // The media daemon restarted under us: stop and keep what exists.
            if let staged = try? self.stop() {
                self.emit(["event": "finished", "reason": "mediaServicesReset", "stagedDir": staged.dir.lastPathComponent])
            }
        }
    }

    private func emit(_ detail: [String: Any]) {
        onEvent?(detail)
    }

    // MARK: AVAudioRecorderDelegate

    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        os_log("encode error: %{public}@", log: Recorder.logger, type: .error, String(describing: error))
        emit(["event": "error", "message": String(describing: error)])
    }
}
