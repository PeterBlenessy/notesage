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

enum AudioOwnerError: Error {
    /// A recording is running; the caller must not take the session over.
    case recordingInProgress
}

final class AudioSessionArbiter {
    static let shared = AudioSessionArbiter()
    private(set) var owner: AudioOwner = .none

    /// Take the session for `owner`. Starting a recording stops speech;
    /// starting speech (or playback) while recording is refused — a meeting
    /// being recorded is worth more than an article being read.
    func claim(
        _ owner: AudioOwner, category: AVAudioSession.Category, mode: AVAudioSession.Mode,
        options: AVAudioSession.CategoryOptions
    ) throws {
        if self.owner == .recording && owner != .recording { throw AudioOwnerError.recordingInProgress }
        if owner == .recording && self.owner == .speech { SpeechPlayer.shared.stop() }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(category, mode: mode, options: options)
        try session.setActive(true)
        self.owner = owner
    }

    /// Give the session back — only if `owner` still holds it, so a late
    /// release from a stopped speech session cannot kill a recording that
    /// took over since.
    func release(_ owner: AudioOwner) {
        guard self.owner == owner else { return }
        self.owner = .none
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
