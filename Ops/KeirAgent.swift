import SwiftUI
import LakesideCore

// MARK: Result cards

/// What a Keir reply touched: tickets, PRs, issues and heal receipts.
struct KeirCards: View {
    @EnvironmentObject private var router: OpsRouter
    let cards: [JSONValue]
    var body: some View {
        VStack(spacing: 8) {
            ForEach(Array(cards.enumerated()), id: \.offset) { _, card in
                if let url = URL(string: card["url"].string), card["type"].string != "ticket" {
                    Link(destination: url) { row(card) }.buttonStyle(.plain)
                } else {
                    Button { router.tab = .ops } label: { row(card) }.buttonStyle(.plain)
                }
            }
        }
    }
    private func row(_ card: JSONValue) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon(card["type"].string)).font(.callout).foregroundStyle(OpsTheme.sky).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title(card)).font(.callout.weight(.semibold)).lineLimit(1)
                Text(meta(card)).font(.caption).foregroundStyle(OpsTheme.muted).lineLimit(1)
            }
            Spacer()
            Image(systemName: card["type"].string == "ticket" ? "chevron.right" : "arrow.up.right").font(.caption).foregroundStyle(OpsTheme.muted)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(OpsTheme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(OpsTheme.hairline))
        .accessibilityElement(children: .combine)
    }
    private func icon(_ type: String) -> String {
        switch type { case "pr": return "arrow.triangle.pull"; case "issue": return "exclamationmark.circle"; case "ticket": return "ticket"; default: return "checkmark.seal" }
    }
    private func title(_ c: JSONValue) -> String {
        switch c["type"].string {
        case "pr": return "PR #\(c["number"].string)"
        case "issue": return c["title"].string.nonempty ?? "Issue #\(c["number"].string)"
        case "ticket": return c["title"].string.nonempty ?? "Ticket #\(c["number"].string)"
        default: return c["label"].string
        }
    }
    private func meta(_ c: JSONValue) -> String {
        switch c["type"].string {
        case "pr": return c["repository"].string
        case "issue": return "Issue #\(c["number"].string) · \(c["state"].string.capitalized)"
        case "ticket": return "Ticket #\(c["number"].string) · open in Desk"
        default: return "\(c["state"].string.capitalized) · \(OpsFormat.ago(c["at"]))"
        }
    }
}

// MARK: Threads

struct KeirThreads: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var keir: KeirStore
    @State private var naming = false
    @State private var title = ""
    @State private var renaming: JSONValue = .null
    var body: some View {
        NavigationStack {
            List {
                ForEach(keir.threads, id: \.["id"].string) { thread in
                    Button { keir.select(thread["id"].string); dismiss() } label: {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(thread["title"].string).font(.callout.weight(.semibold))
                                    if thread["working"].bool { StateWord(text: "Working", color: OpsTheme.mint) }
                                }
                                Text(thread["preview"].string.nonempty ?? (thread["system"].bool ? "Results from your watches" : "No messages yet"))
                                    .font(.caption).foregroundStyle(OpsTheme.muted).lineLimit(2)
                            }
                            Spacer()
                            if thread["id"].string == keir.thread { Image(systemName: "checkmark").font(.caption) }
                        }.padding(.vertical, 4).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    .swipeActions {
                        if !thread["system"].bool && thread["id"].string != "main" {
                            Button("Archive") { Task { _ = try? await session.post("/api/keir/app/threads/\(thread["id"].string)", ["archived": .bool(true)]); await keir.loadThreads(session); if keir.thread == thread["id"].string { keir.select("main") } } }.tint(OpsTheme.warn)
                            Button("Rename") { renaming = thread; title = thread["title"].string }.tint(OpsTheme.sky)
                        }
                    }
                }.listRowBackground(Color.clear)
            }
            .listStyle(.plain).opsScreen().navigationTitle("Threads").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) { Button { title = ""; naming = true } label: { Image(systemName: "square.and.pencil") }.accessibilityLabel("New thread") }
            }
            .alert("New thread", isPresented: $naming) {
                TextField("What is it about?", text: $title)
                Button("Start") { let t = title; Task { await keir.newThread(t, session); dismiss() } }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Rename thread", isPresented: Binding(get: { renaming != .null }, set: { if !$0 { renaming = .null } })) {
                TextField("Title", text: $title)
                Button("Save") { let id = renaming["id"].string, t = title; Task { _ = try? await session.post("/api/keir/app/threads/\(id)", ["title": .string(t)]); await keir.loadThreads(session) } }
                Button("Cancel", role: .cancel) {}
            }
            .task { await keir.loadThreads(session) }
        }
    }
}

// MARK: Activity

struct ActivityView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var ops: OpsStore
    @State private var tasks: [JSONValue] = []
    @State private var approvals: [JSONValue] = []
    @State private var error: String?
    private var live: [JSONValue] { tasks.filter { !["done", "cancelled", "dismissed"].contains($0["state"].string) } }
    private var finished: [JSONValue] { tasks.filter { ["done", "cancelled", "dismissed"].contains($0["state"].string) } }
    var body: some View {
        List {
            if let error { Text(error).font(.caption).foregroundStyle(OpsTheme.warn).listRowBackground(Color.clear) }
            if !approvals.isEmpty {
                Section {
                    ForEach(approvals, id: \.["id"].string) { a in
                        VStack(alignment: .leading, spacing: 6) {
                            if !a["taskTitle"].string.isEmpty { Text("For: \(a["taskTitle"].string)").font(.caption).foregroundStyle(OpsTheme.muted).lineLimit(1) }
                            if !a["action"]["summary"].string.isEmpty { Label(a["action"]["summary"].string, systemImage: "bolt.fill").font(.caption.weight(.semibold)).foregroundStyle(OpsTheme.warn).lineLimit(2) }
                            DecisionCard(decision: a)
                        }.padding(.vertical, 4)
                    }.listRowBackground(Color.clear).listRowSeparator(.hidden)
                } header: { SectionLabel(text: "Approvals", count: approvals.count) }
            }
            Section { rows(live, empty: "Keir has nothing in progress for you.") } header: { SectionLabel(text: "In progress", count: live.count) }
            Section { rows(finished, empty: "Nothing finished yet.") } header: { SectionLabel(text: "Finished") }
        }
        .listStyle(.plain).opsScreen().navigationTitle("Activity").navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { while !Task.isCancelled { await load(); try? await Task.sleep(for: .seconds(15)) } }
    }
    @ViewBuilder private func rows(_ list: [JSONValue], empty: String) -> some View {
        if list.isEmpty { Text(empty).foregroundStyle(OpsTheme.muted).listRowBackground(Color.clear) }
        ForEach(list, id: \.["id"].string) { task in
            NavigationLink { TaskDetail(id: task["id"].string) } label: {
                WorkRow(title: task["title"].string, meta: meta(task), bar: task["decisionPending"].bool ? OpsTheme.warn : task["state"].string == "running" ? OpsTheme.mint : nil) {
                    StateWord(text: task["decisionPending"].bool ? "Needs you" : OpsState.word(task["state"].string), color: task["decisionPending"].bool ? OpsTheme.warn : OpsState.color(task["state"].string))
                }
            }
        }.listRowBackground(Color.clear)
    }
    private func meta(_ t: JSONValue) -> String {
        [t["plan"]["total"].number.map { "Step \(Int(t["plan"]["done"].number ?? 0) + 1) of \(Int($0))" } ?? "", t["plan"]["current"].string, t["goal"].string.isEmpty ? "" : "Goal", t["brief"].bool ? "Brief" : "",
         t["surface"].string == "app" ? "App" : "Discord", t["ticket"].number.map { "Ticket \(Int($0))" } ?? "", t["receipts"].number.map { $0 > 0 ? "\(Int($0)) receipt\($0 == 1 ? "" : "s")" : "" } ?? "", OpsFormat.ago(t["updatedAt"])]
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }
    private func load() async {
        do { tasks = try await session.get("/api/keir/app/tasks")["tasks"].array; error = nil }
        catch { self.error = error.displayMessage }
        if let r = try? await session.get("/api/keir/app/approvals") { approvals = r["approvals"].array }
    }
}

struct TaskDetail: View {
    @EnvironmentObject private var session: AppSession
    let id: String
    @State private var task: JSONValue = .null
    @State private var busy = false
    @State private var retryNote = ""
    @State private var retrying = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if task == .null { ProgressView().frame(maxWidth: .infinity) } else {
                    VStack(alignment: .leading, spacing: 6) {
                        StateWord(text: OpsState.word(task["state"].string), color: OpsState.color(task["state"].string))
                        Text(task["request"].string.nonempty ?? "Task").font(.title3.weight(.semibold)).tracking(-0.3).textSelection(.enabled)
                        Text([task["surface"].string == "app" ? "From the app" : "From Discord", task["model"].string, "started \(OpsFormat.ago(task["at"]))"].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(OpsTheme.muted)
                    }
                    if !task["status"].string.isEmpty { Label(task["status"].string, systemImage: "ellipsis.bubble").font(.callout).foregroundStyle(OpsTheme.mint) }
                    if !task["summary"].string.isEmpty {
                        VStack(alignment: .leading, spacing: 8) { SectionLabel(text: "Where it stands"); Text(task["summary"].string).font(.body).textSelection(.enabled) }
                    }
                    if !task["plan"].array.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel(text: "Plan", count: task["plan"].array.count)
                            ForEach(Array(task["plan"].array.enumerated()), id: \.offset) { _, step in
                                HStack(alignment: .top, spacing: 10) {
                                    Group {
                                        switch step["status"].string {
                                        case "done": Image(systemName: "checkmark.circle.fill").foregroundStyle(OpsTheme.mint)
                                        case "running": ProgressView().controlSize(.mini).tint(OpsTheme.mint)
                                        case "failed": Image(systemName: "xmark.circle.fill").foregroundStyle(OpsTheme.warn)
                                        case "waiting": Image(systemName: "pause.circle").foregroundStyle(OpsTheme.sky)
                                        default: Image(systemName: "circle").foregroundStyle(OpsTheme.muted)
                                        }
                                    }.frame(width: 18)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(step["title"].string).font(.callout).foregroundStyle(step["status"].string == "done" ? OpsTheme.muted : OpsTheme.ink)
                                        if !step["detail"].string.isEmpty { Text(step["detail"].string).font(.caption).foregroundStyle(OpsTheme.muted) }
                                    }
                                }
                            }
                        }
                    }
                    if !task["cards"].array.isEmpty { KeirCards(cards: task["cards"].array) }
                    if !task["live"].array.isEmpty {
                        DisclosureGroup {
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(Array(task["live"].array.enumerated()), id: \.offset) { _, call in
                                    HStack(spacing: 8) {
                                        Image(systemName: call["ok"].bool ? "checkmark" : "exclamationmark.triangle").font(.caption2).foregroundStyle(call["ok"].bool ? OpsTheme.mint : OpsTheme.warn).frame(width: 14)
                                        Text(call["tool"].string).font(.caption.monospaced().weight(.semibold))
                                        Text(call["what"].string).font(.caption.monospaced()).foregroundStyle(OpsTheme.muted).lineLimit(1)
                                        Spacer()
                                        Text(OpsFormat.ago(call["at"])).font(.caption2).foregroundStyle(OpsTheme.muted)
                                    }
                                }
                            }.padding(.top, 6)
                        } label: { Label(task["state"].string == "running" ? "Live work" : "Tool calls", systemImage: "terminal").font(.callout.weight(.semibold)) }
                        .tint(OpsTheme.ink).accessibilityIdentifier("task-live")
                    }
                    if !task["steps"].array.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            SectionLabel(text: "Steps").padding(.bottom, 8)
                            ForEach(Array(task["steps"].array.enumerated()), id: \.offset) { index, step in
                                HStack(alignment: .top, spacing: 12) {
                                    VStack(spacing: 0) {
                                        Circle().fill(OpsState.color(step["state"].string)).frame(width: 8, height: 8).padding(.top, 5)
                                        if index < task["steps"].array.count - 1 { Rectangle().fill(OpsTheme.hairline).frame(width: 1).frame(maxHeight: .infinity) }
                                    }
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(step["summary"].string).font(.callout)
                                        Text("\(OpsState.word(step["state"].string)) · \(OpsFormat.ago(step["at"]))").font(.caption).foregroundStyle(OpsTheme.muted)
                                    }.padding(.bottom, 14)
                                }
                            }
                        }
                    }
                    if !task["receipts"].array.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            SectionLabel(text: "Receipts", count: task["receipts"].array.count)
                            ForEach(Array(task["receipts"].array.enumerated()), id: \.offset) { _, r in
                                WorkRow(title: r["label"].string, meta: "\(r["state"].string.capitalized) · \(OpsFormat.ago(r["at"]))", bar: r["state"].string == "done" ? OpsTheme.mint : OpsTheme.warn)
                                Hairline()
                            }
                        }
                    }
                    HStack(spacing: 10) {
                        if task["canStop"].bool {
                            Button(role: .destructive) { act("stop") } label: { Label("Stop", systemImage: "stop.fill").frame(maxWidth: .infinity).padding(.vertical, 10) }
                                .background(OpsTheme.raised, in: RoundedRectangle(cornerRadius: 10))
                        }
                        if task["canRetry"].bool {
                            Button { retrying = true } label: { Label("Retry", systemImage: "arrow.clockwise").fontWeight(.semibold).frame(maxWidth: .infinity).padding(.vertical, 10) }
                                .background(OpsTheme.sky, in: RoundedRectangle(cornerRadius: 10)).foregroundStyle(OpsTheme.onAccent)
                        }
                    }.buttonStyle(.plain).disabled(busy)
                }
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }
        .opsScreen().navigationTitle("").navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { while !Task.isCancelled { await load(); try? await Task.sleep(for: .seconds(task["state"].string == "running" ? 4 : 20)) } }
        .alert("Retry this task", isPresented: $retrying) {
            TextField("Anything Keir should do differently?", text: $retryNote)
            Button("Retry") { act("retry", retryNote) }
            Button("Cancel", role: .cancel) {}
        }
    }
    private func load() async { if let t = try? await session.get("/api/keir/app/tasks/\(id)") { task = t } }
    private func act(_ verb: String, _ note: String = "") {
        busy = true
        Task {
            _ = try? await session.post("/api/keir/app/tasks/\(id)/\(verb)", verb == "retry" ? ["note": .string(note)] : [:])
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            await load(); busy = false
        }
    }
}

// MARK: Ideas

struct IdeasView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var router: OpsRouter
    @State private var ideas: [JSONValue] = []
    @State private var loaded = false
    var body: some View {
        List {
            if loaded && ideas.isEmpty { Text("No ideas waiting. Keir files them as it finds problems on its own.").foregroundStyle(OpsTheme.muted).listRowBackground(Color.clear) }
            ForEach(ideas, id: \.["id"].string) { idea in
                VStack(alignment: .leading, spacing: 8) {
                    Text(idea["title"].string).font(.callout.weight(.semibold))
                    if !idea["evidence"].string.isEmpty { Text(idea["evidence"].string).font(.caption).foregroundStyle(OpsTheme.muted).lineLimit(5) }
                    HStack(spacing: 14) {
                        if idea["accepted"].bool { StateWord(text: "Keir is on it", color: OpsTheme.mint) }
                        else {
                            Button("Fix it") { decide(idea, "accept") }.fontWeight(.semibold).foregroundStyle(OpsTheme.sky)
                            Button("Dismiss") { decide(idea, "dismiss") }.foregroundStyle(OpsTheme.muted)
                        }
                        Spacer()
                        if let url = URL(string: idea["url"].string) { Link("Issue #\(idea["id"].string)", destination: url).font(.caption) }
                    }.buttonStyle(.plain).font(.callout)
                }.padding(.vertical, 6)
            }.listRowBackground(Color.clear)
        }
        .listStyle(.plain).opsScreen().navigationTitle("Ideas").navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }.task { await load() }
    }
    private func load() async { if let r = try? await session.get("/api/keir/app/ideas") { ideas = r["ideas"].array }; loaded = true }
    private func decide(_ idea: JSONValue, _ verdict: String) {
        Task {
            _ = try? await session.post("/api/keir/app/ideas/\(idea["id"].string)", ["verdict": .string(verdict)])
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            await load()
        }
    }
}

// MARK: Watches

struct WatchesView: View {
    @EnvironmentObject private var session: AppSession
    @State private var watches: [JSONValue] = []
    @State private var adding = false
    var body: some View {
        List {
            Section {
                Button { adding = true } label: { Label("Watch for something", systemImage: "plus.circle.fill").fontWeight(.semibold) }
                    .accessibilityIdentifier("watch-add").listRowBackground(Color.clear)
            } footer: { Text("Keir checks with read-only tools on your schedule and only tells you when it happens.").font(.caption) }
            Section {
                if watches.isEmpty { Text("No watches yet.").foregroundStyle(OpsTheme.muted).listRowBackground(Color.clear) }
                ForEach(watches, id: \.["id"].string) { w in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(w["condition"].string).font(.callout.weight(.semibold)).lineLimit(3)
                            Spacer()
                            Toggle("", isOn: Binding(get: { w["active"].bool }, set: { on in update(w, ["active": .bool(on)]) })).labelsHidden()
                        }
                        Text(meta(w)).font(.caption).foregroundStyle(OpsTheme.muted).lineLimit(2)
                    }.padding(.vertical, 4)
                    .swipeActions { Button("Remove", role: .destructive) { update(w, ["remove": .bool(true)]) } }
                }.listRowBackground(Color.clear)
            } header: { SectionLabel(text: "Watching", count: watches.filter { $0["active"].bool }.count) }
        }
        .listStyle(.plain).opsScreen().navigationTitle("Watches").navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }.task { await load() }
        .sheet(isPresented: $adding) { NewWatch { await load() } }
    }
    private func meta(_ w: JSONValue) -> String {
        var parts = [w["every"].string == "15m" ? "Every 15 min" : w["every"].string.capitalized, w["once"].bool ? "once" : "repeats"]
        if w["running"].bool { parts.append("checking now") }
        else if !w["lastResult"].string.isEmpty { parts.append("last: \(w["lastResult"].string)") }
        if w["hits"].number ?? 0 > 0 { parts.append("hit \(OpsFormat.ago(w["lastHitAt"]))") }
        return parts.joined(separator: " · ")
    }
    private func load() async { if let r = try? await session.get("/api/keir/app/watches") { watches = r["watches"].array } }
    private func update(_ w: JSONValue, _ body: [String: JSONValue]) {
        Task { _ = try? await session.post("/api/keir/app/watches/\(w["id"].string)", body); await load() }
    }
}

private struct NewWatch: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let saved: () async -> Void
    @State private var condition = ""
    @State private var every = "hourly"
    @State private var once = true
    @State private var error: String?
    private let examples = ["PR 4184 on AHDGame is merged", "Turn time goes above 90 seconds", "Ticket 1561 is resolved", "Any service on the status page is not operational"]
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Tell me when…", text: $condition, axis: .vertical).lineLimit(2...5).accessibilityIdentifier("watch-condition")
                    ForEach(examples, id: \.self) { e in Button(e) { condition = e }.font(.caption).foregroundStyle(OpsTheme.muted) }
                }
                Section {
                    Picker("Check", selection: $every) { Text("Every 15 min").tag("15m"); Text("Hourly").tag("hourly"); Text("Every 6 hours").tag("6h"); Text("Daily").tag("daily") }
                    Toggle("Stop after it happens", isOn: $once)
                }
                if let error { Text(error).foregroundStyle(OpsTheme.warn) }
            }
            .scrollContentBackground(.hidden).background(OpsTheme.background)
            .navigationTitle("New watch").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Watch") {
                        Task {
                            do { _ = try await session.post("/api/keir/app/watches", ["condition": .string(condition), "every": .string(every), "once": .bool(once)]); await saved(); dismiss() }
                            catch { self.error = error.displayMessage }
                        }
                    }.disabled(condition.trimmingCharacters(in: .whitespaces).count < 8).accessibilityIdentifier("watch-save")
                }
            }
        }
    }
}

// MARK: Memory

struct MemoryView: View {
    @EnvironmentObject private var session: AppSession
    @State private var notes: [JSONValue] = []
    @State private var total = 0
    @State private var search = ""
    @State private var kind = ""
    @State private var adding = false
    @State private var lesson = ""
    @State private var error: String?
    var body: some View {
        List {
            if let error { Text(error).font(.caption).foregroundStyle(OpsTheme.warn).listRowBackground(Color.clear) }
            Section {
                ForEach(notes, id: \.["id"].string) { note in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(note["text"].string).font(.callout).lineLimit(6).textSelection(.enabled)
                        Text([note["owner"].bool ? "You told Keir" : note["kind"].string.capitalized, note["ticket"].number.map { "Ticket \(Int($0))" } ?? "", OpsFormat.ago(note["at"])].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(note["owner"].bool ? OpsTheme.sky : OpsTheme.muted)
                    }.padding(.vertical, 4)
                    .swipeActions { Button("Forget", role: .destructive) { forget(note) } }
                }.listRowBackground(Color.clear)
            } header: {
                Picker("Kind", selection: $kind) { Text("All").tag(""); Text("Lessons").tag("lesson"); Text("Decisions").tag("decision"); Text("Mechanics").tag("mechanic"); Text("Resolutions").tag("resolution") }
                    .pickerStyle(.segmented).textCase(nil).padding(.bottom, 4)
            } footer: { Text("\(total) notes. Swipe to forget.").font(.caption) }
        }
        .listStyle(.plain).opsScreen().navigationTitle("Memory").navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: "Search what Keir knows")
        .toolbar { Button { lesson = ""; adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Teach Keir") }
        .alert("Teach Keir", isPresented: $adding) {
            TextField("A lesson Keir should always follow", text: $lesson)
            Button("Save") { save() }
            Button("Cancel", role: .cancel) {}
        }
        .task(id: "\(search)|\(kind)") { try? await Task.sleep(for: .milliseconds(250)); await load() }
    }
    private func load() async {
        do { let r = try await session.get("/api/keir/app/memory", query: ["q": search, "kind": kind]); notes = r["notes"].array; total = Int(r["total"].number ?? 0); error = nil }
        catch { self.error = error.displayMessage }
    }
    private func save() {
        Task {
            do { _ = try await session.post("/api/keir/app/memory", ["text": .string(lesson)]); await load() }
            catch { self.error = error.displayMessage }
        }
    }
    private func forget(_ note: JSONValue) {
        Task { _ = try? await session.post("/api/keir/app/memory/\(note["id"].string)/forget", [:]); await load() }
    }
}
