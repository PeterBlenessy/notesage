import AVFoundation
import Foundation

/// Who holds the process-wide audio session. Speech and recording cannot
/// share it: `SpeechPlayer.stop()` used to deactivate the session
/// unconditionally, which would end a recording in progress, and a recorder
/// activating `.playAndRecord` under a running article would silence it
/// with nobody told. One owner at a time, claimed and released explicitly.
enum AudioOwner: String {
    case none, speech, recording, player
}

/// Identifies one claim on the session, so a late release from a superseded
/// attempt cannot undo a live one. Monotonic; never reused.
typealias AudioClaim = UInt64

enum AudioOwnerError: Error {
    /// A recording is running; the caller must not take the session over.
    case recordingInProgress
}

/// The arbiter is reached from TWO threads and must be safe on both.
///
/// `SpeechPlayer` runs on the main thread; the recorder's `stage()` and
/// `engage()` run on its own worker queue, because `AVAudioRecorder.record()` can deadlock
/// inside AudioToolbox and must never hold the main thread. So `claim` is
/// called from main (speech) and from a worker (recording), and the ownership
/// enum was a plain unsynchronized property read and written by both.
///
/// Two rules keep that honest:
///
/// 1. **The state is behind a lock.** Every read and write of the owner goes
///    through `lock`, which is also held across the session activation, so a
///    check and the transition it authorises cannot be interleaved.
/// 2. **`claim` never touches `SpeechPlayer`.** It used to call
///    `SpeechPlayer.shared.stop()` inline, which meant the recorder's worker
///    queue tore down the synthesizer, mutated its paragraph array and wrote
///    `MPNowPlayingInfoCenter` — all main-thread objects — while the main
///    thread could be reading the same state. Handing the session over is now
///    an explicit main-thread step (`yieldSpeechForRecording`) that the caller
///    performs between the recorder's two worker phases — after everything
///    that can fail without the session has succeeded, and immediately before
///    `claim` (#932).
final class AudioSessionArbiter {
    static let shared = AudioSessionArbiter()
    private let lock = NSLock()
    private var current: AudioOwner = .none
    /// Bumped by every successful `claim`, so a release can name the claim it
    /// is undoing rather than only the role that holds it. See
    /// `release(_:claim:)`.
    private var epoch: AudioClaim = 0

    var owner: AudioOwner {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    /// Stop a running article so a recording can take the session.
    ///
    /// Main-thread only, and deliberately separate from `claim`: a meeting
    /// being recorded is worth more than an article being read, but the
    /// stopping is main-thread work and the claiming is not.
    func yieldSpeechForRecording() {
        dispatchPrecondition(condition: .onQueue(.main))
        guard owner == .speech else { return }
        // Named, so the frontend keeps the reader's place: this is the app
        // taking the session for a recording, not an article that ended.
        SpeechPlayer.shared.stop(reason: "yielded")
    }

    /// Take the session for `owner`. Starting speech (or playback) while
    /// recording is refused — the caller must honour the throw rather than
    /// swallow it, or the synthesizer will talk over the microphone.
    @discardableResult
    func claim(
        _ owner: AudioOwner, category: AVAudioSession.Category, mode: AVAudioSession.Mode,
        options: AVAudioSession.CategoryOptions
    ) throws -> AudioClaim {
        lock.lock()
        defer { lock.unlock() }
        if current == .recording && owner != .recording { throw AudioOwnerError.recordingInProgress }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(category, mode: mode, options: options)
        try session.setActive(true)
        current = owner
        epoch &+= 1
        return epoch
    }

    /// Give the session back — only if `owner` still holds it, so a late
    /// release from a stopped speech session cannot kill a recording that
    /// took over since.
    func release(_ owner: AudioOwner) {
        lock.lock()
        defer { lock.unlock() }
        guard current == owner else { return }
        current = .none
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Give back ONE SPECIFIC claim.
    ///
    /// The role guard above cannot separate two claims that share a role, and
    /// the recorder is the caller that could have two: a start answered by the
    /// 8-second watchdog can still return afterwards and try to clean up, by
    /// which point the user may have tapped record again. Releasing by role
    /// there would deactivate a LIVE recording's session while `state` still
    /// said `.recording` — the tick and the lock screen counting on, `stop()`
    /// handing back a truncated file.
    ///
    /// **Today that ordering cannot happen, and this is defence rather than a
    /// fix:** `Recorder.work` is serial, so a second start's phase one cannot
    /// begin until the first attempt's wedged phase two has returned, and the
    /// first attempt's cleanup is enqueued ahead of it. The guard exists
    /// because that is an invariant of a queue declaration three files away —
    /// giving `work` the `.concurrent` attribute would make the race real with
    /// nothing to catch it.
    ///
    /// A claim is therefore identified by an epoch as well as a role, and a
    /// release naming a superseded claim does nothing.
    func release(_ owner: AudioOwner, claim: AudioClaim) {
        lock.lock()
        defer { lock.unlock() }
        guard current == owner, epoch == claim else { return }
        current = .none
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
