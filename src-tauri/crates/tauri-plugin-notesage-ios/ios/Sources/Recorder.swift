import AVFoundation
import Foundation
import MediaPlayer
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
    private var remoteCommandsRegistered = false
    private var nowPlayingTitle: String?
    private var nowPlayingSubtitle: String?
    private var observersInstalled = false
    /// The last metered level and when it was taken — see `currentLevel()`.
    /// Main-thread only, like every other caller of `updateMeters()`.
    private var meteredLevel: (level: Double, at: CFTimeInterval)?
    /// A fifth of the trace's 0.1 s sampling interval — see `currentLevel()`
    /// for why half of it was not enough margin.
    private static let meterCacheWindow: CFTimeInterval = 0.02
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

    /// `title`/`subtitle` are the LOCK SCREEN's words, passed in from the
    /// frontend because that is where this app's translations live — the
    /// native side has no bundle strings of its own outside the Share
    /// Extension. Missing ones fall back to something true in any language
    /// rather than to English prose.
    func start(
        language: String?, title: String?, subtitle: String?,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        nowPlayingTitle = title
        nowPlayingSubtitle = subtitle
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
                // By role, deliberately: this fires only when no start has
                // been adopted (the success path latches `answered` in the
                // same turn it adopts, so it cannot interleave), and the only
                // `.recording` claim that can exist here is this attempt's own
                // — taken by an `engage` still wedged inside AudioToolbox.
                AudioSessionArbiter.shared.release(.recording)
                answer(.failure(RecorderError.ioError("the recorder did not start")))
            }
            // Two phases, and the split is the point (#932).
            //
            // A playing article is stopped by `yieldSpeechForRecording`, which
            // clears the paragraph array — so if the start then fails, there is
            // nothing left to resume and the listener's place is gone. It used
            // to be called here, before anything had been attempted, which made
            // every failure below cost someone their reading: `lowDiskSpace` on
            // a near-full phone is the ordinary case.
            //
            // So everything that can fail WITHOUT the audio session runs first,
            // while speech still owns it. The article stops only once the last
            // answerable question has been answered.
            //
            // This holds only because the JS caller no longer stops speech
            // itself before invoking the recorder — it did, which made this
            // hand-over a no-op on every real start (`owner` was already not
            // `.speech`) and the split pointless. See `startRecording` in
            // `src/lib/recording-controller.ts`, whose test pins it.
            Recorder.work.async {
                do {
                    let dir = try self.stage()
                    DispatchQueue.main.async {
                        // A timed-out start that returns late is thrown away —
                        // and the article is still playing, so nothing to undo
                        // beyond the empty directory.
                        // To the worker, like every other staging cleanup: this
                        // branch is reachable only after the watchdog fired,
                        // which is exactly when re-entering the filesystem on
                        // main is how the watchdog's purpose gets undone.
                        guard !answered else {
                            return Recorder.work.async { self.discardStaging(dir) }
                        }
                        // The hand-over, on the main thread: stopping speech
                        // tears down the synthesizer, its paragraph array and
                        // the now-playing entry, all main-thread state the
                        // worker queue must not touch. The arbiter's `claim`
                        // below therefore only arbitrates.
                        AudioSessionArbiter.shared.yieldSpeechForRecording()
                        Recorder.work.async {
                            do {
                                let (rec, claim) = try self.engage(dir: dir)
                                DispatchQueue.main.async {
                                    guard !answered else { return self.abandon(rec, dir: dir, claim: claim) }
                                    // Latch HERE, in the same main-queue turn
                                    // as `adopt`, and call `completion`
                                    // directly rather than through `answer`.
                                    //
                                    // `answer` only *enqueues* the latch, so
                                    // going through it would leave a window:
                                    // `adopt` sets `.recording`, starts the
                                    // tick, registers the remote commands and
                                    // emits `started` — and if the 8-second
                                    // deadline passes during that, the
                                    // watchdog block is already ready and runs
                                    // BEFORE the enqueued latch. It would then
                                    // see `answered == false`, release the
                                    // session under a running recorder and
                                    // answer failure: JS shows "recording
                                    // failed" after having been told it
                                    // started, while the tick keeps emitting
                                    // and `stop()` refuses to run because
                                    // `state` was reset to `.idle` — a
                                    // recording that cannot be stopped or
                                    // saved until the process dies.
                                    answered = true
                                    self.adopt(rec, dir: dir, language: language)
                                    completion(.success(()))
                                }
                            } catch {
                                answer(.failure(error))
                            }
                        }
                    }
                } catch {
                    answer(.failure(error))
                }
            }
        }
    }

    /// Phase one, on the worker: the checks that can be answered while a
    /// playing article still owns the audio session. Nothing here claims,
    /// activates or re-categorises the session, so a throw costs the caller a
    /// failed recording and nothing else (#932).
    ///
    /// The disk check, a sweep of dead staging directories, and this attempt's
    /// own directory live here — in that order, which `sweepStagedLeftovers`
    /// depends on: it deletes audio-less directories, and the one created two
    /// lines below is audio-less until `record()` runs. Building the
    /// `AVAudioRecorder` deliberately does NOT: `init` configures an encoder
    /// against the session's current input, and on a session still set to
    /// `.playback` for speech — precisely the case this fix is about — it can
    /// throw or hand back a recorder that then refuses to start. That is
    /// device-only behaviour, unverifiable here, and getting it wrong would
    /// break the exact path being fixed. The disk check is the failure people
    /// actually hit (an hour is ~30 MB, and refusing at the start beats a
    /// truncation at minute ninety), and it is the one that matters most.
    private func stage() throws -> URL {
        if let free = try? Recorder.stagingRoot.deletingLastPathComponent()
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            .volumeAvailableCapacityForImportantUsage, free < 200 * 1024 * 1024
        {
            throw RecorderError.lowDiskSpace
        }
        sweepStagedLeftovers()
        let dir = Recorder.stagingRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        os_log("recorder staged at %{public}@", log: Recorder.logger, type: .info, dir.lastPathComponent)
        return dir
    }

    /// Phase two, on the worker: take the session, build the recorder against
    /// it, and start.
    ///
    /// The hand-over has already happened by the time this runs, so a failure
    /// here HAS stopped a playing article. That window cannot be closed — you
    /// cannot learn whether `record()` succeeds without first taking the
    /// session away from speech — but the disk check, the commonest failure by
    /// far, has already passed in `stage`.
    ///
    /// Returns the claim it took, so a late cleanup can name it rather than
    /// releasing whatever happens to own the session by then.
    private func engage(dir: URL) throws -> (AVAudioRecorder, AudioClaim) {
        let claim: AudioClaim
        do {
            // The simulator's audio input deadlocks `record()` whatever the
            // category (AudioToolbox mix-engine lock, observed 2026-09-05 with
            // `.playAndRecord` and with plain `.record`): capture is verified
            // on a device; the watchdog in `start` keeps the simulator usable.
            claim = try AudioSessionArbiter.shared.claim(
                .recording, category: .playAndRecord, mode: .default,
                options: [.allowBluetooth, .defaultToSpeaker])
        } catch {
            os_log("session claim failed: %{public}@", log: Recorder.logger, type: .error, String(describing: error))
            // The staging directory exists by now. It would not be offered
            // back as an orphan — `orphans()` requires an `audio.m4a`, and
            // nothing has created one yet — but an empty directory per failed
            // start accumulates in the container with nothing to clear it.
            discardStaging(dir)
            throw error
        }
        let rec: AVAudioRecorder
        do {
            rec = try AVAudioRecorder(url: dir.appendingPathComponent("audio.m4a"), settings: Recorder.settings)
        } catch {
            AudioSessionArbiter.shared.release(.recording, claim: claim)
            discardStaging(dir)
            throw error
        }
        guard rec.record() else {
            os_log("AVAudioRecorder.record() returned false", log: Recorder.logger, type: .error)
            AudioSessionArbiter.shared.release(.recording, claim: claim)
            discardStaging(dir)
            throw RecorderError.ioError("the recorder did not start")
        }
        rec.isMeteringEnabled = true
        return (rec, claim)
    }

    /// Throw away a running recorder the caller no longer wants — the late
    /// return of a start that already timed out.
    ///
    /// The release names `claim`, not just the `.recording` role, because by
    /// the time this runs the user may have tapped record again and a SECOND
    /// start may be live: releasing by role would deactivate that recording's
    /// session while the UI still showed it running, and `stop()` would hand
    /// back a truncated file. A superseded claim releases nothing.
    ///
    /// The `stop()` goes back to the worker: this runs only after the
    /// 8-second watchdog has fired, which means AudioToolbox has already
    /// misbehaved once, and re-entering it on the main thread is how the
    /// watchdog's whole purpose — keeping the UI alive through exactly that —
    /// gets undone.
    private func abandon(_ rec: AVAudioRecorder, dir: URL, claim: AudioClaim) {
        Recorder.work.async {
            rec.stop()
            AudioSessionArbiter.shared.release(.recording, claim: claim)
            self.discardStaging(dir)
        }
    }

    /// Remove staging directories that hold no audio at all.
    ///
    /// The two phases are separated by two queue hops, so a jetsam or a force
    /// quit in that window leaves a directory behind — and an audio-less one is
    /// invisible to every existing sweeper: `orphans()` skips anything without
    /// an `audio.m4a`, and `discardOrphan` removes only by name. Nothing else
    /// reads `stagingRoot`, so they would accumulate for the life of the
    /// install.
    ///
    /// Safe to run here, and the safety is entirely in the ordering: this
    /// happens BEFORE the attempt creates its own directory, and `start` has
    /// already moved `state` off `.idle`, so no live recording and no live
    /// staging directory can exist to sweep. The audio-less directories it can
    /// see are all dead.
    ///
    /// One guard deliberately absent: a check against the finalizing set. A
    /// bundle on its way into the library still HAS its `audio.m4a` —
    /// `finalizeRecording` copies and only removes the staging directory once
    /// both writes have succeeded — so the file check above already excludes
    /// it, and a second guard would only suggest it does not.
    ///
    /// `Recorder.shared.stagingDir` is likewise not consulted: it is
    /// unsynchronized main-thread state, this runs on the worker, and the
    /// ordering above already makes it `nil`. Reading it would add a
    /// cross-thread access to answer a question that cannot be yes.
    private func sweepStagedLeftovers() {
        guard let dirs = try? FileManager.default.contentsOfDirectory(
            at: Recorder.stagingRoot, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
        else { return }
        for dir in dirs where !FileManager.default.fileExists(
            atPath: dir.appendingPathComponent("audio.m4a").path)
        {
            os_log("sweeping staged leftover %{public}@", log: Recorder.logger, type: .info, dir.lastPathComponent)
            try? FileManager.default.removeItem(at: dir)
        }
    }

    /// Remove a staging directory that will never hold a recording. Never
    /// touches the session: the callers either have not claimed it or have
    /// released their own claim already.
    private func discardStaging(_ dir: URL) {
        try? FileManager.default.removeItem(at: dir)
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
        registerRemoteCommands()
        updateNowPlaying()
        os_log("started %{public}@", log: Recorder.logger, type: .info, dir.lastPathComponent)
        emit(["event": "started"])
    }

    func pause() {
        guard state == .recording, let recorder else { return }
        recorder.pause()
        state = .paused
        updateNowPlaying()
        emit(["event": "paused"])
    }

    func resume() {
        guard state == .paused, let recorder else { return }
        interrupted = false
        guard recorder.record() else { return }
        state = .recording
        updateNowPlaying()
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
        clearNowPlaying()
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

    // MARK: - Lock screen and Control Center

    /// A recording belongs on the lock screen for the same reason playback
    /// does: it is a thing the phone is doing that outlives the app being on
    /// screen, and there was no way to see it — or pause it — without
    /// unlocking and coming back (Peter, device, build 50).
    ///
    /// `isLiveStream` is the honest shape: a recording has an elapsed time
    /// and no duration, so the system draws a running counter rather than a
    /// scrubber for a length nobody knows yet.
    /// Published on TRANSITIONS only — start, pause, resume — the way
    /// `SpeechPlayer` does it, and the way the system expects: given a rate
    /// and an elapsed-time anchor, the lock screen counts on its own. This
    /// used to run on the 1 Hz tick as well, on the theory that a pause-aware
    /// recorder drifts from wall clock; it does not, because the anchor is
    /// `recorder.currentTime`, which is itself pause-aware. That was a
    /// dictionary rewritten to the system's now-playing daemon every second
    /// of a meeting for nothing.
    private func updateNowPlaying() {
        let live = state == .recording
        MPNowPlayingInfoCenter.default().playbackState = live ? .playing : .paused
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: nowPlayingTitle ?? "Notesage",
            MPNowPlayingInfoPropertyIsLiveStream: true,
            MPNowPlayingInfoPropertyPlaybackRate: live ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: recorder?.currentTime ?? 0,
        ]
        if let nowPlayingSubtitle { info[MPMediaItemPropertyArtist] = nowPlayingSubtitle }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func clearNowPlaying() {
        removeRemoteCommands()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped
    }

    /// Pause and resume, and deliberately NOT stop.
    ///
    /// Stopping finalises the bundle into the library, and the discard
    /// question for a slip-of-the-finger recording cannot be asked from a
    /// locked screen. A recording that must end is one unlock away; a
    /// recording ended by accident from a pocket is not recoverable.
    private func registerRemoteCommands() {
        guard !remoteCommandsRegistered else { return }
        remoteCommandsRegistered = true
        let centre = MPRemoteCommandCenter.shared()
        centre.playCommand.addTarget { [weak self] _ in
            DispatchQueue.main.async { self?.resume() }
            return .success
        }
        centre.pauseCommand.addTarget { [weak self] _ in
            DispatchQueue.main.async { self?.pause() }
            return .success
        }
        centre.togglePlayPauseCommand.addTarget { [weak self] _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.state == .recording ? self.pause() : self.resume()
            }
            return .success
        }
    }

    private func removeRemoteCommands() {
        guard remoteCommandsRegistered else { return }
        remoteCommandsRegistered = false
        let centre = MPRemoteCommandCenter.shared()
        centre.playCommand.removeTarget(nil)
        centre.pauseCommand.removeTarget(nil)
        centre.togglePlayPauseCommand.removeTarget(nil)
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
    ///
    /// Internal, not private: the island's live trace samples this 10 times a
    /// second, which is far too often to push across the JS bridge — and the
    /// bridge is asleep with the screen locked anyway, while the recorder is
    /// not.
    /// The mic level as a 0…1 height for the trace.
    ///
    /// NOT a straight `(db + 60) / 60`. That maps the full -60…0 dB range
    /// linearly, and speech does not live in that range: ordinary talking
    /// averages around -25 dB, which came out at 0.58 — over half height —
    /// while a shout at -10 dB reached 0.83. Everything audible therefore
    /// drew tall and within a quarter of everything else, so the trace read
    /// as a solid amplified block rather than a voice (Peter, build 52: "the
    /// loudness illustration is a bit too large... it all gets kind of flat,
    /// although amplified").
    ///
    /// Two changes. The window is -50…-5 dB, which is where speech actually
    /// sits — below that is room tone, above it is clipping. And the result
    /// is raised to a power, which stretches the quiet end downwards: room
    /// tone falls to nearly nothing, conversation lands near a third, and
    /// only a genuinely loud passage fills the bar. The dynamics are then
    /// visible as differences in height, which is the entire point of
    /// drawing a level at all.
    /// Two callers ask for this number: the 1 Hz tick that feeds the JS event,
    /// and the island's trace, which samples at 10 Hz while it is on screen.
    /// Each used to drive its own `updateMeters()` for the same instant.
    ///
    /// Briefly cached rather than plumbed between them, because their
    /// lifetimes differ in a way that matters: the trace exists only while the
    /// island is visible and unpaused, whereas the tick keeps running with the
    /// screen locked and the app backgrounded. Reading the trace's last sample
    /// from the tick — the obvious de-duplication — would emit a level of zero
    /// for every recording made with the phone in a pocket.
    ///
    /// The window is a fifth of the trace's 0.1 s interval, not half of it: a
    /// repeating `Timer` reschedules from its ORIGINAL fire dates, so a
    /// main-thread hitch — scrolling an article while recording, which is why
    /// that timer runs in `.common` mode — can delay one fire and leave the
    /// next only a fraction of an interval behind it. At 0.05 s a 0.04 s gap
    /// would have served the same sample twice and drawn a duplicated bar. The
    /// two callers this exists to collapse land microseconds apart, so the
    /// narrower window costs nothing.
    func currentLevel() -> Double {
        guard let recorder, state == .recording else { return 0 }
        let now = CACurrentMediaTime()
        if let cached = meteredLevel, now - cached.at < Recorder.meterCacheWindow {
            return cached.level
        }
        recorder.updateMeters()
        let db = Double(recorder.averagePower(forChannel: 0))
        let level = Recorder.levelHeight(db: db)
        meteredLevel = (level: level, at: now)
        return level
    }

    /// Pure, so the curve can be reasoned about (and checked) without a mic.
    /// -50 dB → 0.00, -40 → 0.09, -30 → 0.26, -25 → 0.38, -20 → 0.52,
    /// -15 → 0.68, -10 → 0.85, -5 → 1.00.
    static func levelHeight(db: Double) -> Double {
        let floorDb = -50.0
        let ceilDb = -5.0
        let t = (db - floorDb) / (ceilDb - floorDb)
        return pow(max(0, min(1, t)), 1.6)
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
