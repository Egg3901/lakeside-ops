import SwiftUI
import Speech
import AVFoundation

/// Audio belongs to the visible conversation. Starting the microphone interrupts
/// speech playback; leaving the screen releases the microphone and audio session.
@MainActor final class KeirVoice: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published private(set) var listening = false
    @Published private(set) var speaking = false
    @Published private(set) var requesting = false
    @Published var transcript = ""
    @Published var error: String?
    private let engine = AVAudioEngine()
    private let speaker = AVSpeechSynthesizer()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var tapped = false
    private var generation = UUID()

    override init() { super.init(); speaker.delegate = self }

    func start() async {
        stop()
        let token = UUID(); generation = token
        requesting = true; defer { if generation == token { requesting = false } }
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
        guard generation == token else { return }
        let microphone = await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
        }
        guard generation == token else { return }
        guard speech && microphone else { error = "Allow microphone and speech recognition in Settings to talk to Keir."; return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current), recognizer.isAvailable else {
            error = "Speech recognition is unavailable. You can keep typing."; return
        }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try audio.setActive(true)
            let buffer = SFSpeechAudioBufferRecognitionRequest()
            buffer.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition { buffer.requiresOnDeviceRecognition = true }
            request = buffer; transcript = ""; error = nil
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0 && format.channelCount > 0 else {
                throw NSError(domain: "KeirVoice", code: 1, userInfo: [NSLocalizedDescriptionKey: "No microphone is available."])
            }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { audio, _ in buffer.append(audio) }
            tapped = true
            recognition = recognizer.recognitionTask(with: buffer) { [weak self] result, failure in
                Task { @MainActor in
                    guard let self, self.generation == token else { return }
                    if let result { self.transcript = result.bestTranscription.formattedString }
                    if result?.isFinal == true || failure != nil {
                        self.stopListening()
                        if failure != nil && self.transcript.isEmpty { self.error = "Could not hear that. Tap the microphone to try again." }
                    }
                }
            }
            engine.prepare(); try engine.start(); listening = true
        } catch { stopListening(); self.error = error.localizedDescription }
    }

    func stopListening() {
        generation = UUID(); requesting = false
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        request?.endAudio(); recognition?.cancel(); recognition = nil; request = nil
        listening = false
        if !speaking { releaseAudio() }
    }
    func speak(_ text: String) {
        stop()
        guard !text.isEmpty else { return }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .spokenAudio)
            try audio.setActive(true)
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier)
            speaking = true; speaker.speak(utterance)
        } catch { self.error = "Spoken reply could not start."; releaseAudio() }
    }
    func stopSpeaking() { speaker.stopSpeaking(at: .immediate); speaking = false; if !listening { releaseAudio() } }
    func stop() { stopListening(); stopSpeaking() }
    private func releaseAudio() { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            guard let self, !self.speaker.isSpeaking else { return }
            self.speaking = false; if !self.listening { self.releaseAudio() }
        }
    }
}
