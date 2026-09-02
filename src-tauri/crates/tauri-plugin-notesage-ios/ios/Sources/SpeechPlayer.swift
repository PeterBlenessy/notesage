// SpeechPlayer.swift — read a saved article aloud (#833).
//
// A PLAYER, not a fire-and-forget utterance. The motivating case is listening
// while walking or driving, which means it has to survive backgrounding and a
// locked screen, and be controllable without unlocking the phone.
//
// Three pieces make that true, and all three are required:
//
//  1. `AVAudioSession` in `.playback` — without it iOS silences the synthesiser
//     the moment the screen locks, and the feature only works while you are
//     already looking at it, which is the opposite of the point.
//  2. `MPRemoteCommandCenter` — the lock screen and Control Centre controls.
//  3. `MPNowPlayingInfoCenter` — the title and progress on the lock screen.
//
// Text is split into PARAGRAPH utterances rather than queued as one blob. That
// is what makes skip-by-paragraph possible, and it is also what makes resume
// meaningful: a paragraph index is a stable position that survives the app
// being killed, whereas a character offset into a single utterance does not
// survive anything.

import AVFoundation
import MediaPlayer

@objc public final class SpeechPlayer: NSObject {
    @objc public static let shared = SpeechPlayer()

    private let synth = AVSpeechSynthesizer()
    private var paragraphs: [String] = []
    private var index = 0
    private var rate: Float = AVSpeechUtteranceDefaultSpeechRate
    private var voiceId: String?
    private var title = ""

    /// Called on every position change so the frontend can persist resume
    /// state and move its highlight. Set by the plugin.
    @objc public var onProgress: ((Int, Int) -> Void)?

    override private init() {
        super.init()
        synth.delegate = self
    }

    // MARK: - Public surface

    /// Begin (or restart) playback of `text`, resuming at `startIndex`.
    ///
    /// `startIndex` is a paragraph index, clamped — a stored position from a
    /// since-edited article must not crash or silently start from the top.
    @objc public func start(text: String, title: String, startIndex: Int, rate: Float, voiceId: String?) {
        stop()
        self.title = title
        self.rate = rate > 0 ? rate : AVSpeechUtteranceDefaultSpeechRate
        self.voiceId = voiceId
        paragraphs = SpeechPlayer.splitIntoParagraphs(text)
        guard !paragraphs.isEmpty else { return }
        index = min(max(0, startIndex), paragraphs.count - 1)
        activateSession()
        registerRemoteCommands()
        speakCurrent()
    }

    @objc public func pause() {
        // `.immediate` rather than `.word`: on a lock-screen tap the user
        // expects silence now, and resume re-speaks the current paragraph from
        // its start anyway.
        if synth.isSpeaking { synth.pauseSpeaking(at: .immediate) }
        updateNowPlaying(playing: false)
    }

    @objc public func resume() {
        if synth.isPaused {
            synth.continueSpeaking()
        } else if !synth.isSpeaking && !paragraphs.isEmpty {
            // Paused across a process death: nothing is queued any more, so
            // re-speak from the remembered paragraph.
            activateSession()
            speakCurrent()
        }
        updateNowPlaying(playing: true)
    }

    @objc public func stop() {
        synth.stopSpeaking(at: .immediate)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(
            false, options: .notifyOthersOnDeactivation)
    }

    /// Move `delta` paragraphs. Skipping past the end stops; before the start
    /// clamps to 0 (matching how podcast players behave at the boundaries).
    @objc public func skip(_ delta: Int) {
        guard !paragraphs.isEmpty else { return }
        let next = index + delta
        if next < 0 {
            index = 0
        } else if next >= paragraphs.count {
            stop()
            return
        } else {
            index = next
        }
        synth.stopSpeaking(at: .immediate)
        speakCurrent()
    }

    @objc public func setRate(_ newRate: Float) {
        rate = newRate
        // Rate is fixed per utterance, so it only takes effect on the next
        // one. Re-speaking the current paragraph applies it immediately, which
        // is what a user dragging a speed slider expects to hear.
        if synth.isSpeaking {
            synth.stopSpeaking(at: .immediate)
            speakCurrent()
        }
    }

    @objc public var currentIndex: Int { index }
    @objc public var paragraphCount: Int { paragraphs.count }
    @objc public var isPlaying: Bool { synth.isSpeaking && !synth.isPaused }

    // MARK: - Internals

    /// Paragraph split, with the empty runs dropped.
    ///
    /// Blank-line separated, because that is what the reader renders as a
    /// paragraph and what the extracted article gives us. A sentence split
    /// would make skip-back land mid-thought.
    static func splitIntoParagraphs(_ text: String) -> [String] {
        text.components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func speakCurrent() {
        guard index < paragraphs.count else { return }
        let utterance = AVSpeechUtterance(string: paragraphs[index])
        utterance.rate = rate
        if let voiceId, let voice = AVSpeechSynthesisVoice(identifier: voiceId) {
            utterance.voice = voice
        }
        synth.speak(utterance)
        onProgress?(index, paragraphs.count)
        updateNowPlaying(playing: true)
    }

    private func activateSession() {
        let session = AVAudioSession.sharedInstance()
        // `.spokenAudio` tells iOS this is speech, so it ducks correctly
        // against navigation prompts instead of fighting them.
        try? session.setCategory(.playback, mode: .spokenAudio, options: [])
        try? session.setActive(true)
    }

    private func updateNowPlaying(playing: Bool) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
        ]
        // Paragraph index as position: not seconds, but it gives the lock
        // screen a truthful sense of progress through the article, which is
        // the number the user actually cares about.
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = Double(index)
        info[MPMediaItemPropertyPlaybackDuration] = Double(max(paragraphs.count, 1))
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private var remoteCommandsRegistered = false

    private func registerRemoteCommands() {
        guard !remoteCommandsRegistered else { return }
        remoteCommandsRegistered = true
        let centre = MPRemoteCommandCenter.shared()
        centre.playCommand.addTarget { [weak self] _ in self?.resume(); return .success }
        centre.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        centre.nextTrackCommand.addTarget { [weak self] _ in self?.skip(1); return .success }
        centre.previousTrackCommand.addTarget { [weak self] _ in self?.skip(-1); return .success }
    }
}

extension SpeechPlayer: AVSpeechSynthesizerDelegate {
    public func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
    ) {
        // Advance only when the utterance ENDED naturally. skip() and
        // setRate() call stopSpeaking, which fires didCancel rather than
        // didFinish — so auto-advance cannot double-step past a paragraph.
        guard index + 1 < paragraphs.count else {
            onProgress?(paragraphs.count, paragraphs.count)
            stop()
            return
        }
        index += 1
        speakCurrent()
    }
}
