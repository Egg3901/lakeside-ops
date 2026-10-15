import SwiftUI
import LakesideCore

/// A foreground voice conversation: silence submits a turn, replies play, then
/// listening resumes. Ending the mode releases the microphone and playback.
struct KeirVoiceMode: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @ObservedObject var keir: KeirStore
    @StateObject private var voice = KeirVoice()
    @State private var waiting = false
    @State private var paused = false
    @State private var reply = ""
    @State private var lastReply = ""
    @State private var actualRoute = ""
    @State private var since = Date()
    @State private var error: String?
    @State private var active = false
    @State private var listenTask: Task<Void, Never>?
    @State private var expectedJob: String?
    @State private var sendTask: Task<Void, Never>?
    private var fixture: Bool {
#if DEBUG
        ProcessInfo.processInfo.arguments.contains("--uitest-fixtures")
#else
        false
#endif
    }
    private var state: KeirPresence.State {
        if keir.stopped { return .stopped }
        if !keir.connected { return .offline }
        if voice.listening { return .listening }
        if voice.speaking { return .speaking }
        return waiting ? .thinking : .ready
    }
    private var status: String {
        if paused { return "Microphone paused" }
        switch state {
        case .listening: return "I'm listening"
        case .speaking: return "Keir is speaking"
        case .thinking: return "Thinking"
        case .stopped: return "Keir is stopped"
        case .offline: return "Reconnecting"
        default: return "Ready to talk"
        }
    }
    private var routeLabel: String {
        if let current = keir.tasks.first(where: { $0["id"].string == expectedJob && $0["state"].string == "running" }), !current["provider"]["model"].string.isEmpty {
            return current["provider"]["model"].string
        }
        if !actualRoute.isEmpty { return actualRoute }
        let selected = keir.controls["routes"]["conversation"].string
        if !selected.isEmpty && selected != "auto" { return selected }
        if keir.modelSelection != "auto" { return keir.modelSelection }
        return keir.controls["defaults"]["voice"].string.nonempty ?? "Gemini 3.8 Flash"
    }
    private var screen: some View {
        VStack(spacing: 24) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Keir voice").font(.headline)
                    Text("Microsoft Ava · online voice").font(.caption).foregroundStyle(OpsTheme.muted)
                    Text(routeLabel).font(.caption2).foregroundStyle(OpsTheme.muted)
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark").frame(width: 44, height: 44).background(OpsTheme.surface, in: Circle()) }.accessibilityLabel("End voice conversation")
            }
            Spacer(minLength: 12)
            KeirVoiceOrb(state: state, level: voice.level).frame(width: 190, height: 190).accessibilityHidden(true)
            Text(status).font(.largeTitle.weight(.semibold)).contentTransition(.opacity)
            ScrollView {
                VStack(spacing: 18) {
                    if !voice.transcript.isEmpty { Text(voice.transcript).font(.title3).foregroundStyle(OpsTheme.muted) }
                    if !reply.isEmpty { Text(reply).font(.title3).textSelection(.enabled) }
                }.frame(maxWidth: .infinity)
            }.frame(maxHeight: 200)
            if let message = error ?? voice.error { Text(message).font(.callout).foregroundStyle(OpsTheme.warn) }
            Text("Pause to send. Tap the waveform to interrupt.").font(.caption).foregroundStyle(OpsTheme.muted)
            Spacer(minLength: 12)
            controls
        }.padding(24).opsScreen()
    }
    private var controls: some View {
        HStack(spacing: 22) {
            Button {
                paused.toggle(); voice.stop()
                if !paused { listen() }
            } label: { Image(systemName: paused ? "mic.slash.fill" : "mic.fill").frame(width: 58, height: 58).background(OpsTheme.surface, in: Circle()) }
                .accessibilityLabel(paused ? "Resume microphone" : "Pause microphone")
            Button {
                waiting = false; expectedJob = nil; sendTask?.cancel(); error = nil; voice.stop(); paused = false; listen()
            } label: { Image(systemName: "waveform").font(.title).frame(width: 76, height: 76).background(OpsTheme.sky.opacity(0.18), in: Circle()) }
                .accessibilityLabel("Interrupt and speak").disabled(keir.stopped || !keir.connected)
            Button { voice.stop(); dismiss() } label: { Image(systemName: "phone.down.fill").frame(width: 58, height: 58).background(OpsTheme.warn.opacity(0.15), in: Circle()) }.tint(OpsTheme.warn).accessibilityLabel("End voice mode")
        }
    }
    var body: some View {
        screen
            .task(id: phase) { if phase == .active { await keir.connect(session) } }
            .task { active = true; since = Date(); if !fixture { listen() } }
            .onDisappear { active = false; listenTask?.cancel(); sendTask?.cancel(); voice.stop() }
            .onChange(of: phase) { _, next in if next == .background || (next != .active && !voice.requesting) { paused = true; voice.stop() } }
            .onChange(of: keir.stopped) { _, stopped in if stopped { paused = true; voice.stop() } }
            .onChange(of: voice.completedTurn) { _, _ in submit() }
            .onChange(of: voice.speaking) { was, speaking in
                if was && !speaking && !waiting && voice.error == nil { listen() }
            }
            .onChange(of: keir.messages.count) { _, _ in receive() }
    }
    private func listen() {
        guard active, !paused, !waiting, !keir.stopped, keir.connected, phase == .active else { return }
        listenTask?.cancel(); listenTask = Task { await voice.start(automatic: true) }
    }
    private func submit() {
        let text = voice.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard active, !text.isEmpty, !waiting, !paused, phase == .active else { return }
        waiting = true; expectedJob = nil; error = nil; reply = ""
        sendTask = Task {
            let sent = await keir.send(text, session, voice: true)
            guard !Task.isCancelled else { return }
            expectedJob = keir.lastSentJob
            if sent { receive() }
            if !sent { waiting = false; error = keir.error ?? "Couldn't send. Tap to try again." }
        }
    }
    private func receive() {
        guard active, waiting, let message = keir.messages.last,
              message["role"].string == "keir", message["id"].string != lastReply,
              let expectedJob, message["jobId"].string == expectedJob,
              (message["at"].number ?? 0) / 1000 >= since.timeIntervalSince1970 else { return }
        lastReply = message["id"].string; reply = message["text"].string; waiting = false
        actualRoute = message["provider"]["model"].string
        guard !paused, phase == .active else { return }
        voice.speakMicrosoft(reply, session: session)
    }
}

private struct KeirVoiceOrb: View {
    let state: KeirPresence.State
    let level: Double
    @Environment(\.accessibilityReduceMotion) private var reduced
    @Environment(\.scenePhase) private var phase
    private var animate: Bool { !reduced && phase == .active && [.listening, .thinking, .speaking].contains(state) }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 24, paused: !animate)) { tick in
            let t = animate ? tick.date.timeIntervalSinceReferenceDate : 0
            let energy = state == .listening ? level : state == .speaking ? 0.4 : 0.1
            ZStack {
                Circle().fill(OpsTheme.sky.opacity(0.1)).blur(radius: 18)
                Circle().fill(RadialGradient(colors: [OpsTheme.sky.opacity(0.5), OpsTheme.sky.opacity(0.12), .clear], center: .center, startRadius: 5, endRadius: 90))
                ForEach(0..<3) { ring in
                    Circle().stroke(OpsTheme.sky.opacity(0.5 - Double(ring) * 0.12), lineWidth: ring == 0 ? 2.5 : 1)
                        .padding(CGFloat(12 + ring * 13))
                        .scaleEffect(1 + sin(t * 1.6 + Double(ring)) * (0.02 + energy * 0.05))
                }
                HStack(spacing: 7) {
                    ForEach(0..<7) { index in
                        Capsule().fill(OpsTheme.sky)
                            .frame(width: 4, height: 8 + (1 - Double(abs(index - 3)) / 4) * 48 * max(0.15, energy) * (1 + sin(t * 5 + Double(index)) * 0.3))
                    }
                }
            }
        }
    }
}
