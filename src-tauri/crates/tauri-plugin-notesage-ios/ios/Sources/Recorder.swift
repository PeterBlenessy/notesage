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

    /// The audio work runs OFF the main thread: `AVAudioRecorder.record()`
    /// goes through AudioToolbox's XPC, which the simulator has been seen to
    /// deadlock inside (a lock wait in the mix engine, observed 2026-09-05).
    /// A frozen main thread would take the whole app with it; on a worker
    /// the watchdog below reports a start that never returns and the UI
    /// stays usable.
    private static let work = DispatchQueue(label: "com.notesage.recorder", qos: .userInitiated)
    private static let startTimeout: TimeInterval = 8

    func start(language: String?, completion: @escaping (Result<Void, Error>) -> Void) {
        guard state == .idle else { return completion(.failure(RecorderError.alreadyRecording)) }
        state = .finalizing  // claimed: a second tap while starting is refused
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            guard granted else {
                DispatchQueue.main.async {
                    self.state = .idle
                    completion(.failure(RecorderError.microphoneDenied))
                }
                return
            }
            var answered = false
            let answer: (Result<Void, Error>) -> Void = { result in
                DispatchQueue.main.async {
                    guard !answered else { return }
                    answered = true
                    if case .failure(let error) = result {
                        os_log("start failed: %{public}@", log: Recorder.logger, type: .error, String(describing: error))
                        self.state = .idle
                    }
                    completion(result)
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + Recorder.startTimeout) {
                guard !answered else { return }
                os_log("start timed out", log: Recorder.logger, type: .error)
                AudioSessionArbiter.shared.release(.recording)
                answer(.failure(RecorderError.ioError("the recorder did not start")))
            }
            // Hand the session over from a running article HERE, on the main
            // thread, BEFORE the worker starts. Stopping speech tears down the
            // synthesizer, its paragraph array and the now-playing entry —
            // all main-thread state that the recorder's worker queue must not
            // touch. The arbiter's `claim` below therefore only arbitrates.
            DispatchQueue.main.async {
                AudioSessionArbiter.shared.yieldSpeechForRecording()
                Recorder.work.async {
                    do {
                        let (rec, dir) = try self.prepare()
                        DispatchQueue.main.async {
                            // A timed-out start that returns late is thrown away.
                            guard !answered else {
                                rec.stop()
                                try? FileManager.default.removeItem(at: dir)
                                return
                            }
                            self.adopt(rec, dir: dir, language: language)
                            answer(.success(()))
                        }
                    } catch {
                        answer(.failure(error))
                    }
                }
            }
        }
    }

    /// Everything that talks to AudioToolbox, on the worker.
    private func prepare() throws -> (AVAudioRecorder, URL) {
        // An hour is ~30 MB; refusing at the start beats a truncation at
        // minute ninety.
        if let free = try? Recorder.stagingRoot.deletingLastPathComponent()
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            .volumeAvailableCapacityForImportantUsage, free < 200 * 1024 * 1024
        {
            throw RecorderError.lowDiskSpace
        }
        do {
            // The simulator's audio input deadlocks `record()` whatever the
            // category (AudioToolbox mix-engine lock, observed 2026-09-05 with
            // `.playAndRecord` and with plain `.record`): capture is verified
            // on a device; the watchdog above keeps the simulator usable.
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
        os_log("recorder ready at %{public}@", log: Recorder.logger, type: .info, dir.lastPathComponent)
        guard rec.record() else {
            os_log("AVAudioRecorder.record() returned false", log: Recorder.logger, type: .error)
            AudioSessionArbiter.shared.release(.recording)
            try? FileManager.default.removeItem(at: dir)
            throw RecorderError.ioError("the recorder did not start")
        }
        rec.isMeteringEnabled = true
        return (rec, dir)
    }

    /// The recorder is running: take it on (main thread).
    private func adopt(_ rec: AVAudioRecorder, dir: URL, language: String?) {
        rec.delegate = self
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
        // Claimed until the caller has finished with it — see `inFlight`.
        Recorder.beginFinalizing(dir)
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
    /// Staging folders handed out by `stop()` and not yet dealt with.
    ///
    /// `stop()` clears `stagingDir` and returns to idle BEFORE the finalize
    /// runs, which happens on another queue. Without this claim, a state query
    /// landing in that window would report the bundle currently being copied
    /// as an orphan, and accepting "Recover" on it would start a SECOND
    /// finalize over the directory the first one is still reading from.
    /// Unreachable through today's UI, which asks for the recorder state only
    /// at launch — but every other status in this app re-syncs on foreground,
    /// and the day this one does too the window becomes real.
    private static let inFlightLock = NSLock()
    private static var inFlight: Set<String> = []

    static func beginFinalizing(_ dir: URL) {
        inFlightLock.lock()
        defer { inFlightLock.unlock() }
        inFlight.insert(dir.lastPathComponent)
    }

    /// Called once the bundle has been copied into the library, or discarded.
    static func endFinalizing(_ dir: URL) {
        inFlightLock.lock()
        defer { inFlightLock.unlock() }
        inFlight.remove(dir.lastPathComponent)
    }

    static func isFinalizing(_ name: String) -> Bool {
        inFlightLock.lock()
        defer { inFlightLock.unlock() }
        return inFlight.contains(name)
    }

    static func orphans() -> [[String: Any]] {
        guard let dirs = try? FileManager.default.contentsOfDirectory(
            at: stagingRoot, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
        else { return [] }
        return dirs.compactMap { dir in
            let audio = dir.appendingPathComponent("audio.m4a")
            guard FileManager.default.fileExists(atPath: audio.path) else { return nil }
            // The one still being written is not an orphan — nor is one that
            // has been stopped and is on its way into the library.
            if dir == Recorder.shared.stagingDir { return nil }
            if Recorder.isFinalizing(dir.lastPathComponent) { return nil }
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
