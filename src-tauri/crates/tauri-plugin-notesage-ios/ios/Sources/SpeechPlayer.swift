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
import NaturalLanguage
import os.log

/// Paragraphs shorter than this are headings, list items and handles — the
/// noise that misleads whole-document language detection.
private let MIN_VOTING_PARAGRAPH_CHARS = 80
/// Bounds the cost on a long article; the verdict is settled long before this.
private let MAX_VOTING_PARAGRAPHS = 60

@objc public final class SpeechPlayer: NSObject {
    @objc public static let shared = SpeechPlayer()

    private let synth = AVSpeechSynthesizer()
    private var paragraphs: [String] = []
    private var index = 0
    private var rate: Float = AVSpeechUtteranceDefaultSpeechRate
    /// Voice chosen for THIS article, from its own language.
    private var voice: AVSpeechSynthesisVoice?
    private var title = ""
    /// The article's lead image, shown on the lock screen and in Control
    /// Centre instead of the grey placeholder Peter saw (#833).
    private var artwork: MPMediaItemArtwork?

    /// Called on every position change so the frontend can persist resume
    /// state and move its highlight. Set by the plugin.
    @objc public var onProgress: ((Int, Int) -> Void)?

    /// Called whenever playback starts, pauses or resumes — including from the
    /// LOCK SCREEN and Control Centre, which bypass the frontend entirely.
    ///
    /// Without this the transport shows the wrong icon after a lock-screen
    /// pause, and the next tap calls the wrong method.
    @objc public var onPlayingChanged: ((Bool) -> Void)?

    /// Called once when the article has been read to the end, or stopped.
    ///
    /// Distinct from `onProgress(count, count)`: position and liveness are
    /// different facts, and collapsing them left the transport stuck showing
    /// Pause forever after an article finished.
    @objc public var onFinished: (() -> Void)?

    override private init() {
        super.init()
        synth.delegate = self
    }

    // MARK: - Public surface

    /// Begin (or restart) playback of `text`, resuming at `startIndex`.
    ///
    /// `startIndex` is a paragraph index, clamped — a stored position from a
    /// since-edited article must not crash or silently start from the top.
    /// The language the current article was judged to be in ("en"), or nil.
    @objc public private(set) var language: String?

    /// `voiceByLanguage` is the user's own picks, keyed by language subtag
    /// ("en" -> a voice identifier). It wins over every heuristic below: there
    /// is NO API that tells an app which voice the user chose in Settings, so
    /// the app has to remember the choice itself — and honour it.
    /// `language` is detected by the caller OFF the main thread (up to 60
    /// recogniser passes on a long article — enough to hitch the UI right as
    /// Listen is tapped, per review) and handed in here.
    @objc public func start(
        text: String, title: String, startIndex: Int, rate: Float,
        voiceByLanguage: [String: String], language detected: String?,
        artwork image: UIImage?
    ) {
        artwork = image.map { img in
            MPMediaItemArtwork(boundsSize: img.size) { _ in img }
        }
        // NOT `stop()`: that deactivates the audio session with
        // `.notifyOthersOnDeactivation`, so the very first Listen tap ducked
        // and un-ducked every other app's audio for no reason. Tearing down
        // the queue is all a restart needs.
        resetQueue()
        self.title = title
        self.rate = rate > 0 ? rate : AVSpeechUtteranceDefaultSpeechRate
        paragraphs = SpeechPlayer.splitIntoParagraphs(text)
        guard !paragraphs.isEmpty else { return }
        language = detected
        voice = SpeechPlayer.voice(forLanguage: language, chosen: voiceByLanguage)
        index = min(max(0, startIndex), paragraphs.count - 1)
        activateSession()
        registerRemoteCommands()
        speakCurrent()
    }

    @objc public func pause() {
        // Nothing queued means the article already finished; re-publishing
        // now-playing info here resurrected a finished article on the lock
        // screen with its stale title.
        guard synth.isSpeaking || synth.isPaused else { return }
        // `.immediate` rather than `.word`: on a lock-screen tap the user
        // expects silence now, and resume re-speaks the current paragraph from
        // its start anyway.
        synth.pauseSpeaking(at: .immediate)
        updateNowPlaying(playing: false)
        onPlayingChanged?(false)
    }

    @objc public func resume() {
        if synth.isPaused {
            synth.continueSpeaking()
        } else if !synth.isSpeaking && !paragraphs.isEmpty {
            // Paused across a process death: nothing is queued any more, so
            // re-speak from the remembered paragraph.
            activateSession()
            speakCurrent()
        } else if paragraphs.isEmpty {
            // Finished or never started — nothing to resume.
            return
        }
        updateNowPlaying(playing: true)
        onPlayingChanged?(true)
    }

    @objc public func stop() {
        let wasLive = !paragraphs.isEmpty
        resetQueue()
        try? AVAudioSession.sharedInstance().setActive(
            false, options: .notifyOthersOnDeactivation)
        // Tell the frontend playback is over, so the transport can go away
        // instead of sitting there showing Pause for an article that ended.
        if wasLive { onFinished?() }
    }

    /// Tear down the utterance queue and the lock-screen entry, WITHOUT
    /// touching the audio session — a restart needs this much and no more.
    private func resetQueue() {
        synth.stopSpeaking(at: .immediate)
        paragraphs = []
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
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

    /// Switch voice in place; the current paragraph is re-spoken so the user
    /// hears the change immediately, as with `setRate`.
    @objc public func setVoice(identifier: String) {
        guard let picked = AVSpeechSynthesisVoice(identifier: identifier) else { return }
        voice = picked
        // `isSpeaking` only, exactly as `setRate` — NOT `isPaused`. Re-speaking
        // while paused starts audio the user had stopped and flips the
        // transport to Playing under them (review finding). Paused, the new
        // voice simply takes effect from the next paragraph.
        if synth.isSpeaking && !synth.isPaused {
            synth.stopSpeaking(at: .immediate)
            speakCurrent()
        }
    }

    /// Installed voices for a language subtag, best first — the picker's list.
    @objc public static func voices(forLanguageCode code: String) -> [[String: Any]] {
        rankedVoices(forLanguageCode: code).map {
            [
                "id": $0.identifier,
                "name": $0.name,
                "language": $0.language,
                "quality": qualityName($0.quality),
            ]
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
        utterance.voice = voice
        synth.speak(utterance)
        onProgress?(index, paragraphs.count)
        updateNowPlaying(playing: true)
        onPlayingChanged?(true)
    }

    /// Pick a voice for the ARTICLE's language, not the device's.
    ///
    /// Left to iOS, an utterance with no voice is spoken in the system
    /// language: on a Swedish phone, an English article is read by a Swedish
    /// voice, which is close to unintelligible. Detection uses the text
    /// itself, so it is right for a library that mixes languages — which is
    /// the normal case for a read-later app.
    ///
    /// Falls back to the system default (nil) when detection is uncertain or
    /// no voice is installed for the detected language: a default voice is a
    /// worse reading, but silence would be a broken feature.
    static func voice(forLanguage code: String?, chosen: [String: String]) -> AVSpeechSynthesisVoice? {
        guard let code else { return nil }
        // 1. An explicit in-app pick, if it is still installed (voices can be
        //    deleted in Settings; a stale id must not silence us).
        if let id = chosen[code], let picked = AVSpeechSynthesisVoice(identifier: id) {
            log("chose %{public}@ via in-app pick", picked.identifier)
            return picked
        }
        // 2. The SYSTEM's default voice for the user's own region of this
        //    language — what Settings > Spoken Content configures. Peter's
        //    objection was exactly right: if he has selected an English voice
        //    there, the app must not make him select again. Taken only when it
        //    is enhanced/premium, because the factory default is compact and a
        //    compact answer here means iOS did NOT reflect a selection.
        if let system = systemDefaultVoice(forLanguageCode: code) {
            log("chose %{public}@ via system default", system.identifier)
            return system
        }
        // 3. Best installed voice: quality, then the user's region.
        let ranked = rankedVoices(forLanguageCode: code).first
        log("chose %{public}@ via ranking", ranked?.identifier ?? "nil")
        return ranked
    }

    /// iOS's own default voice for `code` — the one Settings › Spoken Content
    /// configures — when it is better than compact, i.e. when it reflects a
    /// choice the user made.
    ///
    /// Asked for EVERY installed region of the language, not only the user's
    /// own: Settings' "English" voice can be from any region (Peter picked
    /// Lee, en-AU), and querying just en-SE/en-US/en-GB never found it — the
    /// player fell through to the ranking and read with premium en-AU Karen,
    /// a different Australian voice. The user's regions are tried first so a
    /// tie between regions resolves the way their language list does.
    static func systemDefaultVoice(forLanguageCode code: String) -> AVSpeechSynthesisVoice? {
        let subtag: (String) -> String? = { $0.split(separator: "-").first.map(String.init) }
        let userRegions = Locale.preferredLanguages.filter { subtag($0) == code }
        let installedRegions = AVSpeechSynthesisVoice.speechVoices()
            .filter { subtag($0.language) == code && !isNoveltyVoice($0) }
            .map(\.language)
        var seen = Set<String>()
        let regions = (userRegions + (code == "en" ? ["en-US", "en-GB"] : []) + installedRegions)
            .filter { seen.insert($0.lowercased()).inserted }
        var best: AVSpeechSynthesisVoice?
        for tag in regions {
            guard let v = AVSpeechSynthesisVoice(language: tag) else { continue }
            log("system default for %{public}@ is %{public}@ (%{public}@)", tag, v.identifier, qualityName(v.quality))
            guard v.quality != .default, !isNoveltyVoice(v) else { continue }
            // Earlier regions win ties; a strictly better tier wins outright.
            if best == nil || quality(v.quality) > quality(best!.quality) { best = v }
        }
        return best
    }

    private static let logger = OSLog(subsystem: "com.notesage.app", category: "speech")
    private static func log(_ format: StaticString, _ args: CVarArg...) {
        // Visible in the device syslog — how the voice question gets answered
        // on hardware without a debugger attached.
        precondition(args.count <= 3, "log() forwards at most 3 arguments")
        switch args.count {
        case 0: os_log(format, log: logger, type: .info)
        case 1: os_log(format, log: logger, type: .info, args[0])
        case 2: os_log(format, log: logger, type: .info, args[0], args[1])
        default: os_log(format, log: logger, type: .info, args[0], args[1], args[2])
        }
    }

    /// Detect the article's language by a PER-PARAGRAPH majority vote.
    ///
    /// Feeding the whole document to `NLLanguageRecognizer` is what the obvious
    /// implementation does, and it is wrong often enough to matter. Measured
    /// against Peter's real library: an X capture whose title is localised
    /// ("Thariq (@trq212) **på** X") came back **Danish at 0.68** across 13,917
    /// characters of plain English prose, and another English article came back
    /// Norwegian at 0.74. One short foreign line at the top swung the verdict
    /// for the entire document.
    ///
    /// Neither more text nor `languageConstraints` helps — both made the WRONG
    /// answers more confident (da 0.68 -> 0.75), so no threshold or margin rule
    /// can separate them from the right ones. Voting can: on the same two
    /// documents the paragraphs split en=64/pl=1 and en=12/pl=1.
    ///
    /// It is also the right shape for the content — a foreign title, a pull
    /// quote, or a boilerplate footer is outvoted by the body instead of
    /// deciding for it.
    static func detectLanguage(_ text: String) -> String? {
        // Short paragraphs (headings, list items, handles) are exactly the
        // noise that misleads the recogniser, so only substantial prose votes.
        let substantial = text.components(separatedBy: "\n\n")
            .filter { $0.count >= MIN_VOTING_PARAGRAPH_CHARS }
        // Spread the sample over the WHOLE document rather than taking the
        // first N: a long foreign block quote or preface at the top would
        // otherwise be the entire electorate — the same unrepresentative-sample
        // bug this vote exists to fix, relocated (review finding).
        let stride = max(1, Int((Double(substantial.count) / Double(MAX_VOTING_PARAGRAPHS)).rounded(.up)))
        let paragraphs = Swift.stride(from: 0, to: substantial.count, by: stride).map { substantial[$0] }

        var votes: [String: Int] = [:]
        for paragraph in paragraphs {
            let recogniser = NLLanguageRecognizer()
            recogniser.processString(paragraph)
            guard let language = recogniser.dominantLanguage else { continue }
            let confidence = recogniser.languageHypotheses(withMaximum: 1)[language] ?? 0
            if confidence >= 0.5 { votes[language.rawValue, default: 0] += 1 }
        }

        if let winner = votes.max(by: { $0.value < $1.value }) {
            let total = votes.values.reduce(0, +)
            // A plurality is not enough for a genuinely mixed document; without
            // a majority, the system default is the safer answer.
            if Double(winner.value) / Double(total) > 0.5 { return winner.key }
            return nil
        }

        // Nothing long enough to vote — a short note, a list. Fall back to
        // whole-text detection, which is what voting replaces only because it
        // has more to work with.
        let recogniser = NLLanguageRecognizer()
        recogniser.processString(String(text.prefix(2000)))
        guard let language = recogniser.dominantLanguage else { return nil }
        let confidence = recogniser.languageHypotheses(withMaximum: 1)[language] ?? 0
        return confidence >= 0.5 ? language.rawValue : nil
    }

    /// Resolve a bare language subtag ("en") to an INSTALLED voice.
    ///
    /// `AVSpeechSynthesisVoice(language:)` does not reliably accept a bare
    /// subtag — it wants a region-qualified tag like "en-US" — and returns nil
    /// when it cannot resolve one, which silently falls back to the device
    /// language. Verified in the simulator: an English article was read by
    /// `com.apple.voice.super-compact.sv-SE.Alva` on a Swedish device.
    ///
    /// Matching against `speechVoices()` also guarantees the voice is actually
    /// present, rather than naming one iOS would have to download.
    /// Installed voices for a language, best first.
    ///
    /// Order: quality tier, then the user's OWN region for that language, then
    /// a fixed sensible order. The region step exists because ranking by
    /// quality alone picks arbitrarily among equals — on Peter's phone it
    /// chose premium en-AU Karen over the premium voice he had actually
    /// selected, which is what "it sounds like the regular Siri voice" was.
    static func rankedVoices(forLanguageCode code: String) -> [AVSpeechSynthesisVoice] {
        let candidates = AVSpeechSynthesisVoice.speechVoices().filter {
            // "en" matches "en-US" and "en-GB", but must not match "en" inside
            // some other tag — compare the subtag, not a substring.
            $0.language.split(separator: "-").first.map(String.init) == code
                && !isNoveltyVoice($0)
        }
        // The user's preferred regions for this language, in their order:
        // Locale.preferredLanguages is the list from Settings > Language.
        let userRegions = Locale.preferredLanguages
            .filter { $0.split(separator: "-").first.map(String.init) == code }
        func regionRank(_ v: AVSpeechSynthesisVoice) -> Int {
            if let i = userRegions.firstIndex(where: { $0.caseInsensitiveCompare(v.language) == .orderedSame }) {
                return i
            }
            // Past the user's own list, prefer the big two before the rest —
            // an English reader who never set a region still expects US or UK,
            // not Australian or Indian, by default.
            let fallback = ["en-US", "en-GB"]
            if let j = fallback.firstIndex(where: { $0.caseInsensitiveCompare(v.language) == .orderedSame }) {
                return userRegions.count + j
            }
            return userRegions.count + fallback.count
        }
        return candidates.sorted { a, b in
            if quality(a.quality) != quality(b.quality) { return quality(a.quality) > quality(b.quality) }
            if regionRank(a) != regionRank(b) { return regionRank(a) < regionRank(b) }
            return a.name < b.name
        }
    }

    /// Apple ships two families nobody wants reading an article: the classic
    /// novelty set (`com.apple.speech.synthesis.voice.*` — Albert, Bad News,
    /// Bahh, Bells, Boing, Bubbles, Zarvox…) and the Eloquence screen-reader
    /// family (`com.apple.eloquence.*` — Eddy, Flo, Grandma, Grandpa…). On the
    /// simulator they are 19 of the 25 English voices, and on a phone they
    /// bury the user's premium voices under a wall of jokes in the picker.
    /// Excluded from both the list and the automatic choice.
    static func isNoveltyVoice(_ v: AVSpeechSynthesisVoice) -> Bool {
        v.identifier.hasPrefix("com.apple.speech.synthesis.voice.")
            || v.identifier.hasPrefix("com.apple.eloquence.")
    }

    private static func qualityName(_ q: AVSpeechSynthesisVoiceQuality) -> String {
        switch q {
        case .premium: return "premium"
        case .enhanced: return "enhanced"
        default: return "default"
        }
    }

    private static func quality(_ q: AVSpeechSynthesisVoiceQuality) -> Int {
        switch q {
        case .premium: return 3
        case .enhanced: return 2
        default: return 1
        }
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
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
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
            stop()
            return
        }
        index += 1
        speakCurrent()
    }
}
