import SwiftUI

/// Motion is driven by real runtime state; audio bars use microphone energy.
struct KeirPresence: View {
    enum State: String { case ready = "Ready", listening = "Listening", thinking = "Thinking", working = "Working", approval = "Needs you", speaking = "Speaking", stopped = "Stopped", offline = "Reconnecting" }
    let state: State
    let level: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var phase
    private var color: Color { state == .stopped || state == .approval ? OpsTheme.warn : state == .offline ? OpsTheme.muted : OpsTheme.sky }
    private var fixture: Bool {
#if DEBUG
        ProcessInfo.processInfo.arguments.contains("--uitest-fixtures")
#else
        false
#endif
    }
    private var moving: Bool { !fixture && !reduceMotion && phase == .active && [.listening, .thinking, .working, .speaking].contains(state) }
    var body: some View {
        HStack(spacing: 12) {
            TimelineView(.animation(minimumInterval: 1 / 24, paused: !moving)) { timeline in
                let t = moving ? timeline.date.timeIntervalSinceReferenceDate : 0
                Canvas { context, size in
                    let center = CGPoint(x: size.width / 2, y: size.height / 2)
                    let breath = moving ? sin(t * 2.2) : 0
                    for ring in 0..<3 {
                        let r = 10 + Double(ring) * 5 + breath * Double(3 - ring) * 0.8
                        let rect = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
                        context.stroke(Path(ellipseIn: rect), with: .color(color.opacity(ring == 0 ? 0.8 : 0.18)), lineWidth: ring == 0 ? 2.5 : 1)
                    }
                    for i in 0..<5 {
                        let energy = state == .listening ? max(0.08, level) : state == .speaking ? 0.4 + sin(t * 6 + Double(i)) * 0.2 : 0.12
                        let height = 3 + energy * (i == 2 ? 15 : i == 1 || i == 3 ? 10 : 6)
                        let rect = CGRect(x: center.x + Double(i - 2) * 4 - 1, y: center.y - height / 2, width: 2, height: height)
                        context.fill(Path(roundedRect: rect, cornerRadius: 1), with: .color(color))
                    }
                    if state == .working || state == .thinking {
                        let p = CGPoint(x: center.x + cos(t * 1.6) * 20, y: center.y + sin(t * 1.6) * 20)
                        context.fill(Path(ellipseIn: CGRect(x: p.x - 2, y: p.y - 2, width: 4, height: 4)), with: .color(color))
                    }
                }
            }.frame(width: 48, height: 48).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(state.rawValue).font(.callout.weight(.semibold)).contentTransition(.numericText())
                Text(detail).font(.caption).foregroundStyle(OpsTheme.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 6)
        .accessibilityElement(children: .combine).accessibilityIdentifier("keir-presence")
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: state)
    }
    private var detail: String {
        switch state {
        case .ready: return "What are we working on?"
        case .listening: return "Your words, as you speak"
        case .thinking: return "Taking in your request"
        case .working: return "Open activity to follow along"
        case .approval: return "An action needs your approval"
        case .speaking: return "Tap the mic to interrupt"
        case .stopped: return "Press Start when you're ready"
        case .offline: return "Your draft stays here"
        }
    }
}
