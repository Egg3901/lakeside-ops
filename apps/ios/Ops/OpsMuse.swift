import SwiftUI
import Charts
import LakesideCore

// Lakeside Ops 2.1: Keir as a personal agent at parity with Meta's Muse.
// Feed (home), Goals, Files, Upcoming and the Ops hub.

// MARK: Feed

struct FeedView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var ops: OpsStore
    @EnvironmentObject private var router: OpsRouter
    @State private var feed: [JSONValue] = []
    @State private var ideas: [JSONValue] = []
    @State private var upcoming: [JSONValue] = []
    @State private var briefing = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(greeting).font(.system(size: 30, weight: .bold, design: .rounded)).tracking(-0.8)
                    Text(subtitle).font(.callout).foregroundStyle(OpsTheme.muted)
                    if let error { Text(error).font(.caption).foregroundStyle(OpsTheme.warn) }
                }
                FeedActivityChart(hub: ops.hub)
                if !ops.decisions.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: "Needs you", count: ops.decisions.count)
                        ForEach(ops.decisions.prefix(2), id: \.["id"].string) { DecisionCard(decision: $0) }
                        if ops.decisions.count > 2 { Button("All approvals") { router.tab = .activity }.font(.callout.weight(.semibold)) }
                    }
                }
                if !ideas.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: "Ideas for you", count: ideas.count)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .top, spacing: 12) { ForEach(ideas.prefix(8), id: \.["id"].string) { IdeaCard(idea: $0) { await load() } } }
                        }
                    }
                }
                if !upcoming.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack { SectionLabel(text: "Coming up"); NavigationLink("All") { UpcomingView() }.font(.caption.weight(.semibold)) }
                        ForEach(Array(upcoming.prefix(3).enumerated()), id: \.offset) { _, u in UpcomingRow(item: u); Hairline() }
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    SectionLabel(text: "Feed")
                    if feed.isEmpty { Text("Keir writes here: the morning brief, wins, warnings and progress on your goals.").font(.callout).foregroundStyle(OpsTheme.muted).padding(.vertical, 8) }
                    ForEach(feed, id: \.["id"].string) { FeedEntry(entry: $0); Hairline() }
                }
            }.padding(16)
        }
        .refreshable { await load(); await ops.refresh(session) }
        .opsScreen().navigationTitle("Feed").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { brief() } label: { Label("Brief me", systemImage: "sun.max").labelStyle(.titleAndIcon) }
                    .disabled(briefing).accessibilityIdentifier("brief-now")
            }
        }
        .task { while !Task.isCancelled { await load(); try? await Task.sleep(for: .seconds(45)) } }
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        return hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening."
    }
    private var subtitle: String {
        let running = Int(ops.kpis["running"].number ?? 0)
        var parts: [String] = []
        if !ops.decisions.isEmpty { parts.append("\(ops.decisions.count) decision\(ops.decisions.count == 1 ? "" : "s") waiting") }
        parts.append(running > 0 ? "Keir is working on \(running) task\(running == 1 ? "" : "s")" : "Keir is idle")
        if !ops.servicesDown.isEmpty { parts.append("\(ops.servicesDown.count) service\(ops.servicesDown.count == 1 ? "" : "s") degraded") }
        return parts.joined(separator: ". ") + "."
    }
    private func load() async {
        async let f = try? session.get("/api/keir/app/feed")
        async let i = try? session.get("/api/keir/app/ideas")
        async let u = try? session.get("/api/keir/app/upcoming")
        let (fv, iv, uv) = await (f, i, u)
        if let fv { feed = fv["feed"].array }
        if let iv { ideas = iv["ideas"].array.filter { !$0["accepted"].bool } }
        if let uv { upcoming = uv["upcoming"].array }
        error = fv == nil ? "The feed could not refresh." : nil
    }
    private func brief() {
        briefing = true
        Task {
            do {
                _ = try await session.post("/api/keir/app/feed/brief", [:])
                error = "Keir is checking trends and preparing your next steps. The brief will appear here."
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } catch { self.error = error.displayMessage }
            briefing = false
        }
    }
}

private struct FeedEntry: View {
    let entry: JSONValue
    private var icon: (String, Color) {
        switch entry["kind"].string {
        case "brief": return ("sun.max.fill", OpsTheme.sky)
        case "win": return ("checkmark.seal.fill", OpsTheme.mint)
        case "warning": return ("exclamationmark.triangle.fill", OpsTheme.warn)
        case "goal": return ("flag.fill", OpsTheme.sky)
        case "insight": return ("lightbulb.fill", OpsTheme.sky)
        default: return ("circle.fill", OpsTheme.muted)
        }
    }
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon.0).font(.callout).foregroundStyle(icon.1).frame(width: 22).padding(.top, 2)
            VStack(alignment: .leading, spacing: 6) {
                Text(entry["title"].string).font(.callout.weight(.semibold))
                if !entry["body"].string.isEmpty { NativeMarkdown(text: entry["body"].string).font(.callout).foregroundStyle(entry["kind"].string == "brief" ? OpsTheme.ink : OpsTheme.muted) }
                ForEach(Array(entry["links"].array.enumerated()), id: \.offset) { _, link in
                    if let url = URL(string: link["url"].string) { Link(link["title"].string.nonempty ?? link["url"].string, destination: url).font(.caption.weight(.semibold)) }
                }
                Text(OpsFormat.ago(entry["at"])).font(.caption).foregroundStyle(OpsTheme.muted)
            }
        }.padding(.vertical, 10).accessibilityElement(children: .combine)
    }
}

private struct IdeaCard: View {
    @EnvironmentObject private var session: AppSession
    let idea: JSONValue
    let changed: () async -> Void
    @State private var busy = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: idea["kind"].string == "issue" ? "exclamationmark.circle" : "lightbulb").foregroundStyle(OpsTheme.sky)
            Text(idea["title"].string).font(.callout.weight(.semibold)).lineLimit(3)
            if !idea["evidence"].string.isEmpty { Text(idea["evidence"].string).font(.caption).foregroundStyle(OpsTheme.muted).lineLimit(4) }
            Spacer(minLength: 0)
            HStack {
                Button("Start") { decide("accept") }.fontWeight(.semibold).foregroundStyle(OpsTheme.sky)
                Spacer()
                Button { decide("dismiss") } label: { Image(systemName: "xmark") }.foregroundStyle(OpsTheme.muted).accessibilityLabel("Dismiss idea")
            }.buttonStyle(.plain).disabled(busy)
        }
        .padding(14).frame(width: 240, height: 200, alignment: .topLeading)
        .background(OpsTheme.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(OpsTheme.hairline))
    }
    private func decide(_ verdict: String) {
        busy = true
        Task { _ = try? await session.post("/api/keir/app/ideas/\(idea["id"].string)", ["verdict": .string(verdict)]); UIImpactFeedbackGenerator(style: .light).impactOccurred(); await changed(); busy = false }
    }
}

// MARK: Goals

struct GoalsView: View {
    @EnvironmentObject private var session: AppSession
    @State private var goals: [JSONValue] = []
    @State private var suggestions: [JSONValue] = []
    @State private var suggestion: JSONValue = .null
    @State private var error: String?
    @State private var adding = false
    @State private var loaded = false
    var body: some View {
        List {
            if loaded && goals.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Give Keir an outcome.").font(.headline)
                    Text("Keir plans it into milestones, works on it on a schedule, and reports progress in your feed.").font(.callout).foregroundStyle(OpsTheme.muted)
                }.padding(.vertical, 12).listRowBackground(Color.clear)
            }
            if let error { Text(error).foregroundStyle(OpsTheme.warn) }
            if !suggestions.isEmpty {
                Section("Suggested by Keir") {
                    ForEach(suggestions.prefix(3), id: \.["id"].string) { idea in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(idea["title"].string).font(.headline)
                            Text(idea["evidence"].string).font(.callout).foregroundStyle(OpsTheme.muted)
                            HStack {
                                Button("Review goal") { suggestion = idea; adding = true }.fontWeight(.semibold)
                                Spacer()
                                Button("Dismiss") { Task { await dismissSuggestion(idea) } }.foregroundStyle(OpsTheme.muted)
                            }.buttonStyle(.borderless)
                        }.padding(.vertical, 6)
                    }
                }
            } else {
                Button { Task {
                    do { _ = try await session.post("/api/keir/app/feed/brief", [:]); error = "Keir is reviewing the evidence for useful goals. Suggestions appear after the brief." }
                    catch { self.error = error.displayMessage }
                } } label: { Label("Ask Keir for goal suggestions", systemImage: "lightbulb") }
            }
            Section("Your goals") {
            ForEach(goals, id: \.["id"].string) { goal in
                NavigationLink { GoalDetail(id: goal["id"].string) } label: { GoalRow(goal: goal) }
            }.listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain).opsScreen().navigationTitle("Goals").navigationBarTitleDisplayMode(.inline)
        .toolbar { Button { suggestion = .null; adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("New goal").accessibilityIdentifier("goal-add") }
        .refreshable { await load() }
        .task { while !Task.isCancelled { await load(); try? await Task.sleep(for: .seconds(30)) } }
        .sheet(isPresented: $adding) { NewGoal(initialTitle: suggestion["title"].string, initialDetail: suggestion["prompt"].string.nonempty ?? suggestion["evidence"].string) {
            if suggestion != .null { await dismissSuggestion(suggestion) }
            await load()
        } }
    }
    private func load() async {
        if let r = try? await session.get("/api/keir/app/goals") { goals = r["goals"].array }
        if let r = try? await session.get("/api/keir/app/ideas") { suggestions = r["ideas"].array.filter { $0["kind"].string == "suggestion" && !$0["accepted"].bool } }
        loaded = true
    }
    private func dismissSuggestion(_ idea: JSONValue) async {
        do { _ = try await session.post("/api/keir/app/ideas/\(idea["id"].string)", ["verdict": .string("dismiss")]); suggestions.removeAll { $0["id"] == idea["id"] } }
        catch { self.error = error.displayMessage }
    }
}

private struct GoalRow: View {
    let goal: JSONValue
    var body: some View {
        HStack(spacing: 14) {
            ProgressRing(value: goal["progress"].number ?? 0, tone: goal["status"].string == "completed" ? OpsTheme.mint : OpsTheme.sky)
            VStack(alignment: .leading, spacing: 3) {
                Text(goal["title"].string).font(.callout.weight(.semibold)).lineLimit(2)
                Text(meta).font(.caption).foregroundStyle(OpsTheme.muted)
                if !goal["blocker"].string.isEmpty { Label(goal["blocker"].string, systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(OpsTheme.warn).lineLimit(2) }
                else if !goal["nextStep"].string.isEmpty { Text("Next: \(goal["nextStep"].string)").font(.caption).foregroundStyle(OpsTheme.muted).lineLimit(2) }
            }
            Spacer()
            if goal["working"].bool { StateWord(text: "Working", color: OpsTheme.mint) }
        }.padding(.vertical, 8)
    }
    private var meta: String {
        let ms = goal["milestones"].array
        let done = ms.filter { $0["done"].bool }.count
        let status = goal["status"].string == "active" ? "" : goal["status"].string.capitalized
        return [goal["category"].string, ms.isEmpty ? "Planning" : "\(done) of \(ms.count) milestones", status].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

struct ProgressRing: View {
    let value: Double
    var tone: Color = OpsTheme.sky
    var size: CGFloat = 38
    var body: some View {
        ZStack {
            Circle().stroke(OpsTheme.raised, lineWidth: 4)
            Circle().trim(from: 0, to: max(0.001, min(1, value))).stroke(tone, style: StrokeStyle(lineWidth: 4, lineCap: .round)).rotationEffect(.degrees(-90))
            Text("\(Int((value * 100).rounded()))").font(.system(size: 11, weight: .semibold, design: .rounded)).monospacedDigit()
        }.frame(width: size, height: size).accessibilityLabel("\(Int((value * 100).rounded())) percent")
    }
}

private struct GoalDetail: View {
    @EnvironmentObject private var session: AppSession
    let id: String
    @State private var goal: JSONValue = .null
    @State private var noting = false
    @State private var note = ""
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if goal == .null { ProgressView().frame(maxWidth: .infinity) } else {
                    HStack(alignment: .top, spacing: 16) {
                        ProgressRing(value: goal["progress"].number ?? 0, size: 56)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(goal["title"].string).font(.title3.weight(.semibold)).tracking(-0.3)
                            Text("\(goal["category"].string) · advances \(goal["cadence"].string == "6h" ? "every 6 hours" : goal["cadence"].string == "3d" ? "every 3 days" : goal["cadence"].string)").font(.caption).foregroundStyle(OpsTheme.muted)
                            if goal["working"].bool { StateWord(text: "Keir is working on it", color: OpsTheme.mint) }
                        }
                    }
                    if !goal["nextStep"].string.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: goal["blocker"].string.isEmpty ? "Next step" : "Blocked")
                            Text(goal["blocker"].string.nonempty ?? goal["nextStep"].string).font(.callout)
                            if !goal["taskId"].string.isEmpty { NavigationLink("Open current task") { TaskDetail(id: goal["taskId"].string) } }
                        }.padding(14).frame(maxWidth: .infinity, alignment: .leading).background(OpsTheme.surface, in: RoundedRectangle(cornerRadius: 14))
                    }
                    if !goal["description"].string.isEmpty { Text(goal["description"].string).font(.callout).foregroundStyle(OpsTheme.muted) }
                    VStack(alignment: .leading, spacing: 0) {
                        SectionLabel(text: "Milestones", count: goal["milestones"].array.count).padding(.bottom, 8)
                        if goal["milestones"].array.isEmpty { Text("Keir is planning the milestones.").font(.callout).foregroundStyle(OpsTheme.muted) }
                        ForEach(Array(goal["milestones"].array.enumerated()), id: \.offset) { _, m in
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: m["done"].bool ? "checkmark.circle.fill" : "circle").foregroundStyle(m["done"].bool ? OpsTheme.mint : OpsTheme.muted)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(m["title"].string).font(.callout).strikethrough(m["done"].bool, color: OpsTheme.muted)
                                    if !m["evidence"].string.isEmpty { Text(m["evidence"].string).font(.caption).foregroundStyle(OpsTheme.muted) }
                                }
                            }.padding(.vertical, 6)
                        }
                    }
                    if !goal["notes"].array.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: "Keir's notes")
                            ForEach(Array(goal["notes"].array.reversed().enumerated()), id: \.offset) { _, n in
                                VStack(alignment: .leading, spacing: 2) { Text(n["text"].string).font(.callout); Text(OpsFormat.ago(n["at"])).font(.caption).foregroundStyle(OpsTheme.muted) }
                            }
                        }
                    }
                    VStack(spacing: 10) {
                        Button { noting = true } label: { Label("Work on it now", systemImage: "play.fill").fontWeight(.semibold).frame(maxWidth: .infinity).padding(.vertical, 11) }
                            .background(OpsTheme.sky, in: RoundedRectangle(cornerRadius: 12)).foregroundStyle(OpsTheme.onAccent).disabled(goal["working"].bool)
                        HStack(spacing: 10) {
                            Button(goal["status"].string == "paused" ? "Resume" : "Pause") { update(["status": .string(goal["status"].string == "paused" ? "active" : "paused")]) }
                                .frame(maxWidth: .infinity).padding(.vertical, 10).background(OpsTheme.raised, in: RoundedRectangle(cornerRadius: 12))
                            Button("Mark complete") { update(["status": .string("completed")]) }
                                .frame(maxWidth: .infinity).padding(.vertical, 10).background(OpsTheme.raised, in: RoundedRectangle(cornerRadius: 12))
                        }
                    }.buttonStyle(.plain)
                }
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }
        .opsScreen().navigationTitle("").navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { while !Task.isCancelled { await load(); try? await Task.sleep(for: .seconds(goal["working"].bool ? 10 : 30)) } }
        .alert("Work on it now", isPresented: $noting) {
            TextField("Anything Keir should focus on?", text: $note)
            Button("Start") { Task { _ = try? await session.post("/api/keir/app/goals/\(id)/advance", ["note": .string(note)]); note = ""; await load() } }
            Button("Cancel", role: .cancel) {}
        }
    }
    private func load() async { if let g = try? await session.get("/api/keir/app/goals/\(id)") { goal = g } }
    private func update(_ body: [String: JSONValue]) { Task { _ = try? await session.post("/api/keir/app/goals/\(id)", body); await load() } }
}

private struct NewGoal: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    var initialTitle = ""
    var initialDetail = ""
    let saved: () async -> Void
    @State private var initialized = false
    @State private var title = ""
    @State private var detail = ""
    @State private var category = "A House Divided"
    @State private var cadence = "daily"
    @State private var error: String?
    private let categories = ["A House Divided", "Lakeside Ops", "Keir", "MetroForge", "Grand Century", "Studio"]
    private let examples = ["Median turn time under 60 seconds", "Every bug ticket answered within 2 hours", "Ship the 1991 iteration 3 seed", "Grow weekly active players by 20%"]
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What outcome do you want?", text: $title, axis: .vertical).lineLimit(1...3).accessibilityIdentifier("goal-title")
                    ForEach(examples, id: \.self) { e in Button(e) { title = e }.font(.caption).foregroundStyle(OpsTheme.muted) }
                }
                Section("Context for Keir") { TextField("Why it matters, constraints, what done looks like", text: $detail, axis: .vertical).lineLimit(2...6) }
                Section {
                    Picker("Area", selection: $category) { ForEach(categories, id: \.self) { Text($0).tag($0) } }
                    Picker("Keir works on it", selection: $cadence) { Text("Every 6 hours").tag("6h"); Text("Daily").tag("daily"); Text("Every 3 days").tag("3d"); Text("Weekly").tag("weekly") }
                }
                if let error { Text(error).foregroundStyle(OpsTheme.warn) }
            }
            .scrollContentBackground(.hidden).background(OpsTheme.background)
            .navigationTitle("New goal").navigationBarTitleDisplayMode(.inline)
            .onAppear { if !initialized { title = initialTitle; detail = initialDetail; initialized = true } }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") {
                        Task {
                            do { _ = try await session.post("/api/keir/app/goals", ["title": .string(title), "description": .string(detail), "category": .string(category), "cadence": .string(cadence)]); await saved(); dismiss() }
                            catch { self.error = error.displayMessage }
                        }
                    }.disabled(title.trimmingCharacters(in: .whitespaces).count < 4).accessibilityIdentifier("goal-save")
                }
            }
        }
    }
}

// MARK: Files

struct FilesView: View {
    @EnvironmentObject private var session: AppSession
    @State private var files: [JSONValue] = []
    @State private var loaded = false
    var body: some View {
        List {
            if loaded && files.isEmpty { Text("Reports and charts Keir makes land here.").foregroundStyle(OpsTheme.muted).listRowBackground(Color.clear) }
            ForEach(files, id: \.["id"].string) { file in
                NavigationLink { FileDetail(file: file) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: file["kind"].string == "chart" ? "chart.bar.xaxis" : file["kind"].string == "table" ? "tablecells" : "doc.richtext").foregroundStyle(OpsTheme.sky).frame(width: 24)
                        WorkRow(title: file["title"].string, meta: [file["kind"].string.capitalized, OpsFormat.ago(file["at"])].joined(separator: " · "))
                    }
                }
            }.listRowBackground(Color.clear)
        }
        .listStyle(.plain).opsScreen().navigationTitle("Files").navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }.task { await load() }
    }
    private func load() async { if let r = try? await session.get("/api/keir/app/files") { files = r["files"].array }; loaded = true }
}

private struct FileDetail: View {
    @EnvironmentObject private var session: AppSession
    let file: JSONValue
    @State private var full: JSONValue = .null
    @State private var image: UIImage?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(file["title"].string).font(.title3.weight(.semibold))
                if file["kind"].string == "chart" {
                    if let image { Image(uiImage: image).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 12)) } else { ProgressView() }
                } else if full != .null {
                    NativeMarkdown(text: full["markdown"].string).textSelection(.enabled)
                } else { ProgressView() }
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }
        .opsScreen().navigationTitle("").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if file["kind"].string == "chart", let image { ShareLink(item: Image(uiImage: image), preview: SharePreview(file["title"].string, image: Image(uiImage: image))) }
            else if !full["markdown"].string.isEmpty { ShareLink(item: full["markdown"].string) }
        }
        .task {
            if file["kind"].string == "chart" { if let data = try? await session.data("/api/keir/app/artifacts/\(file["file"].string)") { image = UIImage(data: data) } }
            else if let r = try? await session.get("/api/keir/app/files/\(file["id"].string)") { full = r }
        }
    }
}

// MARK: Upcoming

struct UpcomingView: View {
    @EnvironmentObject private var session: AppSession
    @State private var items: [JSONValue] = []
    var body: some View {
        List {
            if items.isEmpty { Text("Nothing scheduled.").foregroundStyle(OpsTheme.muted).listRowBackground(Color.clear) }
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in UpcomingRow(item: item) }.listRowBackground(Color.clear)
        }
        .listStyle(.plain).opsScreen().navigationTitle("Upcoming").navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }.task { await load() }
    }
    private func load() async { if let r = try? await session.get("/api/keir/app/upcoming") { items = r["upcoming"].array } }
}

struct UpcomingRow: View {
    let item: JSONValue
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon).foregroundStyle(OpsTheme.sky).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(item["title"].string).font(.callout).lineLimit(2)
                Text(when).font(.caption).foregroundStyle(OpsTheme.muted)
            }
            Spacer()
        }.padding(.vertical, 8).accessibilityElement(children: .combine)
    }
    private var icon: String {
        switch item["kind"].string { case "watch": return "binoculars"; case "goal": return "flag"; case "brief": return "sun.max"; case "ticket": return "ticket"; case "turn": return "arrow.triangle.2.circlepath"; default: return "clock" }
    }
    private var when: String {
        guard let date = OpsFormat.date(item["at"]) else { return item["kind"].string == "turn" ? "After the turn" : "Soon" }
        if date.timeIntervalSinceNow < 60 { return "Now" }
        return date.formatted(.relative(presentation: .named)) + " · " + date.formatted(date: .omitted, time: .shortened)
    }
}

// MARK: Ops hub

struct OpsHub: View {
    @EnvironmentObject private var ops: OpsStore
    @EnvironmentObject private var router: OpsRouter
    var body: some View {
        List {
            if ops.servicesDown.count + ops.redPRs > 0 {
                Section {
                    NavigationLink { OpsAttentionView() } label: { Label("\(ops.servicesDown.count + ops.redPRs) need attention", systemImage: "exclamationmark.circle.fill").foregroundStyle(OpsTheme.warn) }
                }
            }
            Section {
                link("Pulse", "waveform.path.ecg", ops.servicesDown.isEmpty ? "All services up" : "\(ops.servicesDown.count) degraded") { PulseView() }
                link("Desk", "tray.full", "\(Int(ops.kpis["openTickets"].number ?? 0)) open tickets") { DeskView() }
                link("Work", "rectangle.split.3x1", "\(ops.needsOwner.count) need you · \(ops.blocked.count) blocked") { WorkView() }
            } header: { SectionLabel(text: "Studio") }
            Section {
                link("Dashboard", "chart.bar.xaxis", "Keir metrics, delivery and monitoring") { KeirMetricsView() }
                link("Files", "doc.richtext", "Reports and charts") { FilesView() }
                link("Upcoming", "calendar", "What Keir does next") { UpcomingView() }
                link("Watches", "binoculars", "Tell me when…") { WatchesView() }
                link("Ideas", "lightbulb", "What Keir found") { IdeasView() }
                link("Memory", "brain", "What Keir knows") { MemoryView() }
            } header: { SectionLabel(text: "Keir") }
        }
        .listStyle(.plain).opsScreen().navigationTitle("Ops").navigationBarTitleDisplayMode(.inline)
    }
    private func link<D: View>(_ title: String, _ icon: String, _ detail: String, @ViewBuilder destination: @escaping () -> D) -> some View {
        NavigationLink { destination() } label: {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.body).foregroundStyle(OpsTheme.sky).frame(width: 26)
                VStack(alignment: .leading, spacing: 2) { Text(title).font(.callout.weight(.semibold)); Text(detail).font(.caption).foregroundStyle(OpsTheme.muted) }
            }.padding(.vertical, 6)
        }.listRowBackground(Color.clear).accessibilityIdentifier("hub-\(title.lowercased())")
    }
}

// MARK: Identity

struct KeirIdentitySection: View {
    @EnvironmentObject private var session: AppSession
    @State private var identity: JSONValue = .null
    var body: some View {
        Section {
            Picker("Keir's tone", selection: Binding(get: { identity["tone"].string.nonempty ?? "concise" }, set: { save(["tone": .string($0)]) })) {
                Text("Concise").tag("concise"); Text("Warm").tag("warm"); Text("Thorough").tag("thorough")
            }
            Toggle("Narrate progress while working", isOn: Binding(get: { identity["showUpdates"] == .null ? true : identity["showUpdates"].bool }, set: { save(["showUpdates": .bool($0)]) }))
            Toggle("Morning brief", isOn: Binding(get: { identity["briefOn"] == .null ? true : identity["briefOn"].bool }, set: { save(["briefOn": .bool($0)]) }))
            Picker("Brief at", selection: Binding(get: { Int(identity["briefHour"].number ?? 8) }, set: { save(["briefHour": .number(Double($0))]) })) {
                ForEach(5..<12) { h in Text("\(h):00 AM ET").tag(h) }
            }
        } header: { Text("Keir") }
        .task { if let r = try? await session.get("/api/keir/app/identity") { identity = r } }
    }
    private func save(_ body: [String: JSONValue]) {
        Task { if let r = try? await session.post("/api/keir/app/identity", body) { identity = r } }
    }
}


struct FeedActivityChart: View {
    let hub: JSONValue
    @State private var selected: Date?
    @State private var duration = false
    private var buckets: [JSONValue] { hub["activity"].array.filter { $0["at"].number != nil } }
    private func count(_ row: JSONValue) -> Double { ["claude", "codex", "muse", "agy", "other"].reduce(0) { $0 + (row[$1].number ?? 0) } }
    private var inspected: JSONValue? {
        guard let selected else { return buckets.last }
        return buckets.min { abs(($0["at"].number ?? 0) / 1000 - selected.timeIntervalSince1970) < abs(($1["at"].number ?? 0) / 1000 - selected.timeIntervalSince1970) }
    }
    var body: some View {
        if !buckets.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack { SectionLabel(text: "Last 24 hours"); Spacer(); Button(duration ? "Model time" : "Activity") { duration.toggle() }.font(.caption).accessibilityLabel("Toggle activity and average model duration") }
                Chart(Array(buckets.enumerated()), id: \.offset) { _, row in
                    let date = Date(timeIntervalSince1970: (row["at"].number ?? 0) / 1000)
                    if duration {
                        if count(row) > 0, let ms = row["ms"].number {
                            LineMark(x: .value("Hour", date), y: .value("Seconds", ms / count(row) / 1000)).foregroundStyle(OpsTheme.sky)
                            PointMark(x: .value("Hour", date), y: .value("Seconds", ms / count(row) / 1000)).foregroundStyle(OpsTheme.sky).symbolSize(10)
                        }
                    } else {
                        BarMark(x: .value("Hour", date, unit: .hour), y: .value("Activations", count(row))).foregroundStyle(OpsTheme.sky.gradient).cornerRadius(3)
                    }
                }.frame(height: 110).chartXSelection(value: $selected).chartXAxis { AxisMarks(values: .stride(by: .hour, count: 6)) { _ in AxisValueLabel(format: .dateTime.hour()) } }
                    .accessibilityIdentifier("feed-activity-chart")
                if let row = inspected {
                    Text("\(Date(timeIntervalSince1970: (row["at"].number ?? 0) / 1000).formatted(date: .omitted, time: .shortened)): \(Int(count(row))) activations\(row["failed"].number.map { ", \(Int($0)) unsuccessful" } ?? "")")
                        .font(.caption).foregroundStyle(OpsTheme.muted)
                }
                Text(duration ? "Average completed model duration, not message response time. Tap or drag to inspect." : "Completed model activations. Tap or drag to inspect.")
                    .font(.caption2).foregroundStyle(OpsTheme.muted)
            }.padding(14).background(OpsTheme.surface, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}
