// On-device transcription with Apple's dictation model (macOS 26+,
// SpeechAnalyzer + DictationTranscriber). Fast (≈40× real time on Apple
// silicon), no network, and — unlike Whisper — it doesn't invent text on
// silence or noise. Supports Turkish; SpeechTranscriber (the newer long-form
// model) does not, so DictationTranscriber is used.
//
// Results come back as JSON so the C boundary stays simple:
//   {"ok":true,"locale":"tr-TR","segments":[{"start":0.0,"end":3.2,"text":"…"}]}
//   {"ok":false,"error":"…"}
import AVFoundation
import Foundation
import Speech

/// A segment ends at a pause of at least this long between words…
private let pauseSplitSeconds = 0.7
/// …or once it has run this long, so the transcript stays readable.
private let maxSegmentSeconds = 20.0

private func jsonString(_ object: [String: Any]) -> UnsafeMutablePointer<CChar>? {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let text = String(data: data, encoding: .utf8) else {
        return strdup("{\"ok\":false,\"error\":\"json encoding failed\"}")
    }
    return strdup(text)
}

/// Blocks the calling (non-main) thread on an async operation.
private func blocking<T>(_ body: @escaping () async -> T) -> T {
    let semaphore = DispatchSemaphore(value: 0)
    var result: T?
    Task.detached {
        result = await body()
        semaphore.signal()
    }
    semaphore.wait()
    return result!
}

@available(macOS 26.0, *)
private func resolveLocale(_ requested: String) async -> Locale? {
    let wanted = requested == "auto" ? Locale.current : Locale(identifier: requested)
    return await DictationTranscriber.supportedLocale(equivalentTo: wanted)
}

@available(macOS 26.0, *)
private func transcribe(path: String, locale requested: String) async -> [String: Any] {
    guard let locale = await resolveLocale(requested) else {
        return ["ok": false, "error": "unsupported_locale"]
    }
    let transcriber = DictationTranscriber(
        locale: locale,
        contentHints: [],
        transcriptionOptions: [.punctuation],
        reportingOptions: [],
        attributeOptions: [.audioTimeRange])
    do {
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let collector = Task { () throws -> [[String: Any]] in
            var segments: [[String: Any]] = []
            for try await result in transcriber.results where result.isFinal {
                var words: [(start: Double, end: Double, text: String)] = []
                for run in result.text.runs {
                    let piece = String(result.text[run.range].characters)
                    if let range = run.audioTimeRange {
                        words.append((range.start.seconds, range.end.seconds, piece))
                    } else if var last = words.popLast() {
                        last.text += piece
                        words.append(last)
                    }
                }
                var text = ""
                var start = -1.0
                var end = 0.0
                func flush() {
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty, start >= 0 {
                        segments.append(["start": start, "end": end, "text": trimmed])
                    }
                    text = ""
                    start = -1
                }
                for (i, word) in words.enumerated() {
                    let gap = i > 0 ? word.start - words[i - 1].end : 0
                    if !text.isEmpty && (gap >= pauseSplitSeconds || word.end - start > maxSegmentSeconds) {
                        flush()
                    }
                    if start < 0 { start = word.start }
                    text += word.text
                    end = word.end
                    if let last = text.trimmingCharacters(in: .whitespaces).last, ".?!".contains(last) {
                        flush()
                    }
                }
                flush()
            }
            return segments
        }
        let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
        if let lastSample = try await analyzer.analyzeSequence(from: file) {
            try await analyzer.finalizeAndFinish(through: lastSample)
        } else {
            await analyzer.cancelAndFinishNow()
        }
        let segments = try await collector.value
        return ["ok": true, "locale": locale.identifier(.bcp47), "segments": segments]
    } catch {
        return ["ok": false, "error": "\(error)"]
    }
}

/// Transcribes an audio file. Returns a JSON C string (free with
/// `echomind_free_cstring`). Must not be called on the main thread.
@_cdecl("echomind_dictate_file")
public func echomind_dictate_file(
    _ path: UnsafePointer<CChar>, _ locale: UnsafePointer<CChar>
) -> UnsafeMutablePointer<CChar>? {
    let filePath = String(cString: path)
    let localeId = String(cString: locale)
    guard #available(macOS 26.0, *) else {
        return jsonString(["ok": false, "error": "requires_macos_26"])
    }
    return jsonString(blocking { await transcribe(path: filePath, locale: localeId) })
}

/// 1 when on-device dictation can transcribe `locale` on this Mac.
@_cdecl("echomind_dictation_supported")
public func echomind_dictation_supported(_ locale: UnsafePointer<CChar>) -> Int32 {
    let localeId = String(cString: locale)
    guard #available(macOS 26.0, *) else { return 0 }
    return blocking { await resolveLocale(localeId) != nil } ? 1 : 0
}

@_cdecl("echomind_free_cstring")
public func echomind_free_cstring(_ pointer: UnsafeMutablePointer<CChar>?) {
    free(pointer)
}
