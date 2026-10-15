import SwiftUI
import Speech
import AVFoundation

/// Audio belongs to the visible conversation. Starting the microphone interrupts
/// speech playback; leaving the screen releases the microphone and audio session.
@MainActor final class KeirVoice: NSObject, ObservableObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    @Published private(set) var listening = false
    @Published private(set) var speaking = false
    @Published private(set) var requesting = false
    @Published private(set) var level = 0.0
    @Published private(set) var completedTurn = 0
    @Published var transcript = ""
    @Published var error: String?
    private let engine = AVAudioEngine()
    private let speaker = AVSpeechSynthesizer()
    private var player: AVAudioPlayer?
    private var playback: Task<Void, Never>?
    private var playbackID = UUID()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var tapped = false
    private var generation = UUID()
    private var silenceTask: Task<Void, Never>?
    private var lastSpeech = Date()
    private var automaticTurn = false

    override init() { super.init(); speaker.delegate = self }

    func start(automatic: Bool = false) async {
        stop()
        let token = UUID(); generation = token; automaticTurn = automatic; lastSpeech = Date()
        requesting = true; defer { if generation == token { requesting = false } }
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
        guard !Task.isCancelled, generation == token else { return }
        let microphone = await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
        }
        guard !Task.isCancelled, generation == token else { return }
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
            input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] audio, _ in
                buffer.append(audio)
                guard let samples = audio.floatChannelData?[0], audio.frameLength > 0 else { return }
                var sum: Float = 0
                for i in 0..<Int(audio.frameLength) { sum += samples[i] * samples[i] }
                let energy = min(1, Double(sqrt(sum / Float(audio.frameLength))) * 12)
                Task { @MainActor in
                    guard self?.generation == token else { return }
                    self?.level = energy
                }
            }
            tapped = true
            recognition = recognizer.recognitionTask(with: buffer) { [weak self] result, failure in
                Task { @MainActor in
                    guard let self, self.generation == token else { return }
                    if let result {
                        let text = result.bestTranscription.formattedString
                        if text != self.transcript { self.lastSpeech = Date(); self.transcript = text }
                    }
                    if result?.isFinal == true || failure != nil {
                        let submit = self.automaticTurn && !self.transcript.isEmpty
                        self.stopListening()
                        if submit { self.completedTurn += 1 }
                        if failure != nil && self.transcript.isEmpty { self.error = "Could not hear that. Tap the microphone to try again." }
                    }
                }
            }
            engine.prepare(); try engine.start(); listening = true
            if automatic {
                silenceTask = Task { @MainActor [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .milliseconds(200))
                        guard !Task.isCancelled, let self, self.generation == token else { return }
                        if !self.transcript.isEmpty && Date().timeIntervalSince(self.lastSpeech) > 1.2 {
                            self.stopListening(); self.completedTurn += 1; return
                        }
                    }
                }
            }
        } catch { stopListening(); self.error = error.localizedDescription }
    }

    func stopListening() {
        generation = UUID(); requesting = false; silenceTask?.cancel(); silenceTask = nil
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        request?.endAudio(); recognition?.cancel(); recognition = nil; request = nil
        listening = false; level = 0
        if !speaking { releaseAudio() }
    }
    func speak(_ text: String) {
        stop()
        guard !text.isEmpty else { return }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .spokenAudio)
            try audio.setActive(true)
            let cleaned = Self.spokenText(text)
            guard !cleaned.isEmpty else { releaseAudio(); return }
            let identifier = UserDefaults.standard.string(forKey: "keir-voice-id") ?? "auto"
            let speed = UserDefaults.standard.object(forKey: "keir-voice-rate") as? Double ?? 0.92
            let selected = identifier == "auto" ? Self.bestVoice : AVSpeechSynthesisVoice(identifier: identifier) ?? Self.bestVoice
            speaking = true
            // Paragraphs keep natural pauses and let playback begin immediately.
            for paragraph in cleaned.components(separatedBy: "\n\n").filter({ !$0.isEmpty }) {
                let utterance = AVSpeechUtterance(string: paragraph)
                utterance.voice = selected
                utterance.rate = AVSpeechUtteranceDefaultSpeechRate * Float(min(1.2, max(0.7, speed)))
                utterance.postUtteranceDelay = 0.15
                speaker.speak(utterance)
            }
        } catch { self.error = "Spoken reply could not start."; releaseAudio() }
    }
    func speakMicrosoft(_ text: String, session: AppSession) {
        stop()
        let cleaned = Self.spokenText(text)
        guard !cleaned.isEmpty else { return }
        let token = UUID(); playbackID = token; speaking = true; error = nil
        playback = Task { @MainActor [weak self] in
            do {
                let data = try await session.speechAudio(cleaned)
                guard let self, !Task.isCancelled, self.playbackID == token else { return }
                let audio = AVAudioSession.sharedInstance()
                try audio.setCategory(.playback, mode: .spokenAudio)
                try audio.setActive(true)
                let player = try AVAudioPlayer(data: data)
                player.delegate = self; self.player = player
                guard player.play() else { throw URLError(.cannotDecodeContentData) }
            } catch {
                guard let self, !Task.isCancelled, self.playbackID == token else { return }
                self.error = error.displayMessage; self.speaking = false; self.releaseAudio()
            }
        }
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self, self.player === player else { return }
            self.player = nil; self.speaking = false; self.releaseAudio()
            if !flag { self.error = "Voice playback was interrupted. Tap to try again." }
        }
    }
    static var availableVoices: [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices().sorted {
            if $0.language != $1.language { return $0.language < $1.language }
            if $0.quality != $1.quality { return $0.quality.rawValue > $1.quality.rawValue }
            return $0.name < $1.name
        }
    }
    static var bestVoice: AVSpeechSynthesisVoice? {
        let language = Locale.current.language.languageCode?.identifier ?? "en"
        let locale = Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
        return availableVoices.filter { $0.language.hasPrefix(language) }.sorted {
            if $0.quality != $1.quality { return $0.quality.rawValue > $1.quality.rawValue }
            return ($0.language == locale ? 1 : 0) > ($1.language == locale ? 1 : 0)
        }.first ?? AVSpeechSynthesisVoice(language: locale)
    }
    static func spokenText(_ text: String) -> String {
        text.replacingOccurrences(of: "```[\\s\\S]*?```", with: "Code is shown in the conversation.", options: .regularExpression)
            .replacingOccurrences(of: "!\\[[^\\]]*\\]\\([^)]*\\)", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\[([^\\]]+)\\]\\([^)]*\\)", with: "$1", options: .regularExpression)
            .replacingOccurrences(of: "(?m)^\\s{0,3}(?:#{1,6}\\s+|[-*]\\s+|>\\s*)", with: "", options: .regularExpression)
            .replacingOccurrences(of: "[*_`]", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    func stopSpeaking() { playbackID = UUID(); playback?.cancel(); playback = nil; player?.stop(); player = nil; speaker.stopSpeaking(at: .immediate); speaking = false; if !listening { releaseAudio() } }
    func stop() { stopListening(); stopSpeaking() }
    private func releaseAudio() { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            guard let self, !self.speaker.isSpeaking else { return }
            self.speaking = false; if !self.listening { self.releaseAudio() }
        }
    }
}
