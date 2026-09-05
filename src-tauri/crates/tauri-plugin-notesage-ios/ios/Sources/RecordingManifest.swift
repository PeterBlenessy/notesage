import Foundation

/// `recording.json`, written by the phone beside `audio.m4a` and annotated
/// by the Mac with the transcription's status. Unknown fields are the other
/// side's; they are preserved by re-reading the file before a rewrite.
struct RecordingManifest: Codable {
    struct CreatedBy: Codable {
        let device: String
        let app: String
        let appVersion: String
    }
    struct Audio: Codable {
        let file: String
        let bytes: Int
        let codec: String
        let sampleRate: Int
        let channels: Int
        let bitrate: Int?
    }
    struct Transcription: Codable {
        let status: String
        let device: String
        let updatedAt: String
        let model: String?
        let engine: String?
        let language: String?
        let error: String?
    }

    let version: Int
    let createdBy: CreatedBy
    let startedAt: String
    let durationSecs: Double
    let source: String
    let language: String?
    let audio: Audio
    let transcription: Transcription?

    static let fileName = "recording.json"

    /// The contract's stamp: internet date-time with fractional seconds and
    /// the LOCAL UTC offset, matching what the Mac writes (`isoWithOffset` in
    /// `manifest.ts`). Left at the formatter's default this emitted `…Z`, so
    /// the same field carried two conventions depending on which device
    /// recorded the bundle — harmless to the tolerant parser, but the offset
    /// form is what the contract documents, and a recording's stamp reads
    /// better in the wall-clock time it was made in.
    static func iso8601(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone.current
        return f.string(from: date)
    }

    /// The contract says `"transcription": null` until the Mac writes its
    /// status; `JSONEncoder` drops a nil optional, so it is put back.
    func json() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        let encoded = try encoder.encode(self)
        var object = try JSONSerialization.jsonObject(with: encoded) as? [String: Any] ?? [:]
        if object["transcription"] == nil { object["transcription"] = NSNull() }
        return try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    }
}
