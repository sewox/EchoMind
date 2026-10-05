// Reads meeting summaries aloud with the system voices (AVSpeechSynthesizer).
// Offline, no extra install: macOS ships voices for every app language.
//
// State codes shared with Rust (src/tts.rs): 0 idle, 1 speaking, 2 paused.
import AVFoundation
import Foundation

private final class SpeechPlayer: NSObject, AVSpeechSynthesizerDelegate {
    static let shared = SpeechPlayer()

    private let synthesizer = AVSpeechSynthesizer()
    private let lock = NSLock()
    private var current: Int32 = 0

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    var state: Int32 {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    func setState(_ value: Int32) {
        lock.lock()
        current = value
        lock.unlock()
    }

    func speak(_ utterance: AVSpeechUtterance) {
        // Callers see "speaking" right away; the delegate moves it to idle at the end.
        setState(1)
        DispatchQueue.main.async {
            self.synthesizer.stopSpeaking(at: .immediate)
            self.setState(1)
            self.synthesizer.speak(utterance)
        }
    }

    func stop() {
        setState(0)
        DispatchQueue.main.async { self.synthesizer.stopSpeaking(at: .immediate) }
    }

    func pause() {
        if state == 1 { setState(2) }
        DispatchQueue.main.async { _ = self.synthesizer.pauseSpeaking(at: .word) }
    }

    func resume() {
        if state == 2 { setState(1) }
        DispatchQueue.main.async { _ = self.synthesizer.continueSpeaking() }
    }

    func speechSynthesizer(_: AVSpeechSynthesizer, didFinish _: AVSpeechUtterance) { setState(0) }
    func speechSynthesizer(_: AVSpeechSynthesizer, didCancel _: AVSpeechUtterance) { setState(0) }
    func speechSynthesizer(_: AVSpeechSynthesizer, didPause _: AVSpeechUtterance) { setState(2) }
    func speechSynthesizer(_: AVSpeechSynthesizer, didContinue _: AVSpeechUtterance) { setState(1) }
}

/// The best installed voice for a language ("tr-TR", "en-US"…): highest
/// quality first; among equals, the system's default voice for the language.
/// Novelty voices (Bubbles, Zarvox…) are never picked.
private func bestVoice(for language: String) -> AVSpeechSynthesisVoice? {
    let wanted = language.lowercased()
    let base = wanted.split(separator: "-").first.map(String.init) ?? wanted
    let fallback = AVSpeechSynthesisVoice(language: language)
    let candidates = AVSpeechSynthesisVoice.speechVoices().filter { voice in
        let code = voice.language.lowercased()
        guard code == wanted || code == base || code.hasPrefix(base + "-") else { return false }
        if #available(macOS 14.0, *), voice.voiceTraits.contains(.isNoveltyVoice) { return false }
        return true
    }
    func rank(_ voice: AVSpeechSynthesisVoice) -> (Int, Int, Int) {
        (voice.quality.rawValue,
         voice.identifier == fallback?.identifier ? 1 : 0,
         voice.language.lowercased() == wanted ? 1 : 0)
    }
    return candidates.max { rank($0) < rank($1) } ?? fallback
}

private func cString(_ text: String) -> UnsafeMutablePointer<CChar>? {
    strdup(text)
}

/// Name of the voice that would read `lang`, or "" when none is installed.
@_cdecl("echomind_tts_voice")
public func echomind_tts_voice(_ lang: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    cString(bestVoice(for: String(cString: lang))?.name ?? "")
}

/// Starts reading `text`; returns the voice name, or "" when the language has
/// no installed voice (nothing is spoken then). `rate` is a multiplier (1 = normal).
@_cdecl("echomind_tts_speak")
public func echomind_tts_speak(
    _ text: UnsafePointer<CChar>, _ lang: UnsafePointer<CChar>, _ rate: Float
) -> UnsafeMutablePointer<CChar>? {
    guard let voice = bestVoice(for: String(cString: lang)) else { return cString("") }
    let utterance = AVSpeechUtterance(string: String(cString: text))
    utterance.voice = voice
    let scaled = AVSpeechUtteranceDefaultSpeechRate * max(0.5, min(rate, 2.0))
    utterance.rate = min(max(scaled, AVSpeechUtteranceMinimumSpeechRate), AVSpeechUtteranceMaximumSpeechRate)
    SpeechPlayer.shared.speak(utterance)
    return cString(voice.name)
}

@_cdecl("echomind_tts_stop")
public func echomind_tts_stop() { SpeechPlayer.shared.stop() }

@_cdecl("echomind_tts_pause")
public func echomind_tts_pause() { SpeechPlayer.shared.pause() }

@_cdecl("echomind_tts_resume")
public func echomind_tts_resume() { SpeechPlayer.shared.resume() }

@_cdecl("echomind_tts_state")
public func echomind_tts_state() -> Int32 { SpeechPlayer.shared.state }
