import SwiftUI
import LakesideCore

struct KeirView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var ops: OpsStore
    @ObservedObject var keir: KeirStore
    @State private var draft = ""
    @FocusState private var composing: Bool
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 22) {
                        if !ops.decisions.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                SectionLabel(text: "Needs you", count: ops.decisions.count)
                                ForEach(ops.decisions, id: \.["id"].string) { DecisionCard(decision: $0) }
                            }
                        }
                        if keir.messages.isEmpty { KeirEmpty { draft = $0; composing = true } }
                        ForEach(keir.messages, id: \.["id"].string) { KeirMessage(message: $0) }
                        ForEach(keir.live, id: \.["id"].string) { task in KeirTaskLine(task: task) { Task { await keir.stop(task["id"].string, session) } } }
                        Color.clear.frame(height: 1).id("end")
                    }.padding(.horizontal, 16).padding(.vertical, 16)
                }
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.bottom)
                .onChange(of: keir.messages.count) { _, _ in withAnimation(.snappy) { proxy.scrollTo("end", anchor: .bottom) } }
                .onChange(of: keir.live.count) { _, _ in withAnimation(.snappy) { proxy.scrollTo("end", anchor: .bottom) } }
            }
            if let error = keir.error { Text(error).font(.caption).foregroundStyle(OpsTheme.warn).padding(.horizontal, 16).padding(.bottom, 4).lineLimit(2) }
            composer
        }
        .opsScreen()
        .navigationTitle("Keir").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 6) {
                    Text("Keir").font(.headline)
                    StateWord(text: keir.working ? "Working" : keir.connected ? "Here" : "Reconnecting", color: keir.working ? OpsTheme.mint : keir.connected ? OpsTheme.muted : OpsTheme.warn)
                }.accessibilityElement(children: .combine)
            }
        }
        .task(id: scenePhase == .active) { if scenePhase == .active { await keir.connect(session) } }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Ask Keir or tell it what to do", text: $draft, axis: .vertical).lineLimit(1...6).focused($composing)
                .accessibilityIdentifier("keir-composer").padding(.vertical, 8)
            Button {
                let text = draft
                Task { if await keir.send(text, session) { if draft == text { draft = "" } } }
            } label: {
                Image(systemName: "arrow.up").font(.body.weight(.semibold)).frame(width: 34, height: 34)
                    .background(OpsTheme.sky, in: Circle()).foregroundStyle(OpsTheme.onAccent)
            }
            .disabled(keir.sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("Send to Keir").accessibilityIdentifier("keir-send")
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(OpsTheme.surface, in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(OpsTheme.hairline))
        .padding(.horizontal, 12).padding(.bottom, 8)
    }
}

private struct KeirEmpty: View {
    let pick: (String) -> Void
    private let prompts = ["What needs my attention right now?", "How did the last turn go?", "Which PRs are waiting on me?", "Promote development to production"]
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Keir").font(.system(size: 34, weight: .bold, design: .rounded)).tracking(-1)
            Text("Owner channel. Anything you ask here carries your authority, the same as a DM.").font(.callout).foregroundStyle(OpsTheme.muted)
            VStack(spacing: 0) {
                ForEach(prompts, id: \.self) { prompt in
                    Button { pick(prompt) } label: {
                        HStack { Text(prompt).font(.callout); Spacer(); Image(systemName: "arrow.up.left").font(.caption) }.padding(.vertical, 12)
                    }.buttonStyle(.plain)
                    Hairline()
                }
            }
        }.padding(.top, 24)
    }
}

private struct KeirMessage: View {
    @EnvironmentObject private var session: AppSession
    let message: JSONValue
    private var owner: Bool { message["role"].string == "owner" }
    var body: some View {
        if owner {
            HStack {
                Spacer(minLength: 48)
                Text(message["text"].string).textSelection(.enabled).padding(.horizontal, 14).padding(.vertical, 10)
                    .background(OpsTheme.sky.opacity(0.16), in: RoundedRectangle(cornerRadius: 18))
            }.accessibilityLabel("You: \(message["text"].string)")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Text("Keir").font(.caption.weight(.semibold))
                    Text(OpsFormat.ago(message["at"])).font(.caption).foregroundStyle(OpsTheme.muted)
                }
                NativeMarkdown(text: message["text"].string).textSelection(.enabled)
                if !message["chart"].string.isEmpty { KeirChart(name: message["chart"].string) }
            }
            .contextMenu {
                Button { UIPasteboard.general.string = message["text"].string } label: { Label("Copy", systemImage: "doc.on.doc") }
                ShareLink(item: message["text"].string)
            }
        }
    }
}

private struct KeirChart: View {
    @EnvironmentObject private var session: AppSession
    let name: String
    @State private var image: UIImage?
    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 12)) }
            else { RoundedRectangle(cornerRadius: 12).fill(OpsTheme.surface).frame(height: 180).overlay(ProgressView()) }
        }
        .task(id: name) {
            if let data = try? await session.data("/api/keir/app/artifacts/\(name)") { image = UIImage(data: data) }
        }.accessibilityLabel("Chart from Keir")
    }
}

private struct KeirTaskLine: View {
    let task: JSONValue
    let stop: () -> Void
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if task["state"].string == "running" { ProgressView().controlSize(.small).tint(OpsTheme.mint) }
            else { Circle().fill(OpsState.color(task["state"].string)).frame(width: 7, height: 7).padding(.top, 6) }
            VStack(alignment: .leading, spacing: 2) {
                Text(task["status"].string.nonempty ?? (task["state"].string == "running" ? "Working on it" : OpsState.word(task["state"].string)))
                    .font(.callout).foregroundStyle(OpsTheme.ink)
                Text("\(task["kind"].string == "conversation" ? "Question" : "Task") · started \(OpsFormat.ago(task["at"]))").font(.caption).foregroundStyle(OpsTheme.muted)
            }
            Spacer()
            Button(role: .destructive, action: stop) { Image(systemName: "stop.circle").font(.title3) }
                .buttonStyle(.plain).foregroundStyle(OpsTheme.muted).accessibilityLabel("Stop this task")
        }
        .padding(12).background(OpsTheme.surface, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// An open question from Keir. Approve is the primary action; reject and
/// explain stay one tap away.
struct DecisionCard: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var ops: OpsStore
    let decision: JSONValue
    @State private var explaining = false
    @State private var note = ""
    @State private var busy = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                StateWord(text: decision["signoff"].bool ? "Sign-off" : "Decision", color: OpsTheme.warn)
                if let n = decision["ticket"].number { Text("Ticket \(Int(n))").font(.caption).foregroundStyle(OpsTheme.muted) }
                Spacer()
                Text(OpsFormat.ago(decision["at"])).font(.caption).foregroundStyle(OpsTheme.muted)
            }
            if !decision["tldr"].string.isEmpty { Text(decision["tldr"].string).font(.callout.weight(.semibold)) }
            Text(decision["question"].string).font(.callout).foregroundStyle(decision["tldr"].string.isEmpty ? OpsTheme.ink : OpsTheme.muted).lineLimit(8)
            HStack(spacing: 10) {
                Button { act("approve") } label: { Text("Approve").fontWeight(.semibold).frame(maxWidth: .infinity).padding(.vertical, 9) }
                    .background(OpsTheme.sky, in: RoundedRectangle(cornerRadius: 10)).foregroundStyle(OpsTheme.onAccent)
                    .accessibilityIdentifier("decision-approve")
                Button { act("reject") } label: { Text("Reject").frame(maxWidth: .infinity).padding(.vertical, 9) }
                    .background(OpsTheme.raised, in: RoundedRectangle(cornerRadius: 10))
                Button { explaining = true } label: { Image(systemName: "text.bubble").padding(.vertical, 9).padding(.horizontal, 12) }
                    .background(OpsTheme.raised, in: RoundedRectangle(cornerRadius: 10)).accessibilityLabel("Reply or ask why")
            }.buttonStyle(.plain).disabled(busy)
        }
        .padding(14)
        .background(OpsTheme.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 1).fill(OpsTheme.warn).frame(width: 2).padding(.vertical, 14) }
        .alert("Reply to Keir", isPresented: $explaining) {
            TextField("What should Keir explain or change?", text: $note)
            Button("Send") { act("explain", note) }
            Button("Cancel", role: .cancel) {}
        }
    }
    private func act(_ verdict: String, _ text: String = "") {
        busy = true
        Task { _ = await ops.answer(decision["id"].string, verdict: verdict, text: text, session); busy = false }
    }
}
