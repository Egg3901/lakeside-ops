import SwiftUI
import LakesideCore

/// OpenMuse-style shared browser: the owner inspects Keir's exact screen and
/// pauses its task before taking control. Screenshots stay on the signed API.
struct KeirComputer: View {
    @EnvironmentObject private var session: AppSession
    @State private var computers: [JSONValue] = []
    @State private var error: String?
    @State private var request = ""
    var body: some View {
        List {
            Section {
                TextField("What should Keir do on the computer?", text: $request, axis: .vertical)
                Button("Ask Keir") {
                    let text = request
                    Task {
                        let keir = OpsServices.shared.keir
                        keir.sendMode = "new"; keir.steeringTask = nil
                        if await keir.send("Use your computer for this task: \(text)", session) { request = "" }
                    }
                }.disabled(request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if let error { Text(error).foregroundStyle(OpsTheme.warn) }
            if computers.isEmpty { Text("Keir's browser workspaces will appear here. Open a public page or ask it to build and test an interface.").font(.callout).foregroundStyle(OpsTheme.muted) }
            ForEach(computers, id: \.["taskId"].string) { computer in
                NavigationLink { KeirComputerScreen(taskId: computer["taskId"].string) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(computer["title"].string.nonempty ?? "Browser").font(.callout.weight(.semibold))
                        Text(computer["url"].string.nonempty ?? "Interface preview").font(.caption).foregroundStyle(OpsTheme.muted).lineLimit(1)
                        Text(OpsState.word(computer["state"].string)).font(.caption2).foregroundStyle(OpsState.color(computer["state"].string))
                    }
                }
            }
        }.listStyle(.plain).opsScreen().navigationTitle("Computer").navigationBarTitleDisplayMode(.inline)
            .task { await load() }.refreshable { await load() }
    }
    private func load() async {
        do { computers = try await session.get("/api/keir/app/computer")["computers"].array; error = nil }
        catch { self.error = error.displayMessage }
    }
}

struct KeirComputerScreen: View {
    @EnvironmentObject private var session: AppSession
    let taskId: String
    @State private var computer: JSONValue = .null
    @State private var image: UIImage?
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    @State private var confirmingDiscard = false
    @Environment(\.scenePhase) private var scenePhase
    private var controlled: Bool { computer["state"].string == "paused" && !computer["closed"].bool }
    private var active: Bool { !["done", "cancelled", "dismissed"].contains(computer["state"].string) && !computer["closed"].bool }
    private var uncertain: Bool { !computer["uncertainInputs"].array.isEmpty }
    private var retained: Bool { computer["retainedForInspection"].bool }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(retained ? "Needs inspection" : controlled ? "You have control" : active ? "Keir's screen" : "Saved result").font(.callout.weight(.semibold))
                    Spacer()
                    if active {
                        Button(controlled ? "Return to Keir" : "Take control") { Task { await control() } }.font(.callout).disabled(busy)
                    }
                }
                Text(computer["url"].string.nonempty ?? "Interface preview").font(.caption).foregroundStyle(OpsTheme.muted).textSelection(.enabled)
                if let image {
                    Image(uiImage: image).resizable().scaledToFit()
                        .overlay {
                            GeometryReader { geometry in
                                Color.clear.contentShape(Rectangle()).gesture(SpatialTapGesture().onEnded { tap in
                                    guard controlled && !busy && !uncertain else { return }
                                    let x = min(geometry.size.width - 1, max(0, tap.location.x)) / geometry.size.width * (computer["width"].number ?? 1280)
                                    let y = min(geometry.size.height - 1, max(0, tap.location.y)) / geometry.size.height * (computer["height"].number ?? 800)
                                    Task { await input(["action": .string("click"), "x": .number(x), "y": .number(y)]) }
                                })
                            }
                        }.accessibilityLabel("Keir browser screenshot").accessibilityIdentifier("keir-computer-screen")
                } else { Text("Waiting for a screen").font(.caption).foregroundStyle(OpsTheme.muted) }
                if controlled || retained {
                    if uncertain || retained {
                        Text("The previous input may have succeeded. Inspect a fresh screen before entering anything else.").font(.callout).foregroundStyle(OpsTheme.warn)
                        Button("Refresh browser screen") { Task { await input(["action": .string("look")]) } }.disabled(busy)
                        ForEach(computer["uncertainInputs"].array, id: \.["id"].string) { receipt in
                            Button(retained ? "I inspected the previous input." : "I inspected the result. Allow new input.") {
                                Task { await input(["action": .string("acknowledge"), "effectId": receipt["id"]]) }
                            }.disabled(busy || receipt["screen"] == computer["file"])
                        }
                    }
                }
                if retained {
                    Button("Discard retained browser", role: .destructive) { confirmingDiscard = true }.disabled(busy)
                }
                if controlled {
                    HStack {
                        TextField("Type into the focused field", text: $text)
                        Button("Type") { let value = text; Task { await input(["action": .string("type"), "text": .string(value)]); text = "" } }.disabled(text.isEmpty || busy)
                    }.disabled(uncertain)
                    HStack {
                        Button("Tab") { Task { await input(["action": .string("key"), "key": .string("Tab")]) } }
                        Button("Enter") { Task { await input(["action": .string("key"), "key": .string("Enter")]) } }
                        Spacer()
                        Button { Task { await input(["action": .string("scroll"), "y": .number(-500)]) } } label: { Image(systemName: "arrow.up") }.accessibilityLabel("Scroll up")
                        Button { Task { await input(["action": .string("scroll"), "y": .number(500)]) } } label: { Image(systemName: "arrow.down") }.accessibilityLabel("Scroll down")
                    }.disabled(busy || uncertain)
                    Button("Close browser and delete its profile", role: .destructive) { Task { await input(["action": .string("close")]) } }.disabled(busy || uncertain)
                }
                if let error { Text(error).font(.caption).foregroundStyle(OpsTheme.warn) }
                DisclosureGroup("Page text") { Text(computer["text"].string).font(.callout).textSelection(.enabled) }
                NavigationLink("Open task") { TaskDetail(id: taskId) }.font(.callout)
            }.padding(16)
        }.opsScreen().navigationTitle(computer["title"].string.nonempty ?? "Browser").navigationBarTitleDisplayMode(.inline)
            .confirmationDialog("Delete this browser and its saved profile? The action outcome will remain unverified in the receipt.", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Discard browser and profile", role: .destructive) { Task { await input(["action": .string("discard"), "confirmDiscard": .bool(true)]) } }
            }
            .task(id: scenePhase == .active) {
                while scenePhase == .active && !Task.isCancelled {
                    await load()
                    do { try await Task.sleep(for: .seconds(3)) } catch { return }
                }
            }
    }
    private func load() async {
        do {
            let next = try await session.get("/api/keir/app/computer/\(taskId)")
            if image == nil || next["file"] != computer["file"], !next["file"].string.isEmpty {
                image = UIImage(data: try await session.data("/api/keir/app/artifacts/\(next["file"].string)"))
            }
            computer = next; error = nil
        } catch { if !Task.isCancelled { self.error = error.displayMessage } }
    }
    private func control() async {
        busy = true; defer { busy = false }
        do { _ = try await session.post("/api/keir/app/tasks/\(taskId)/\(controlled ? "resume" : "pause")", [:]); await load() }
        catch { self.error = error.displayMessage }
    }
    private func input(_ body: [String: JSONValue]) async {
        busy = true; defer { busy = false }
        var request = body
        request["clientId"] = .string(UUID().uuidString)
        request["screen"] = computer["file"]
        do { _ = try await session.post("/api/keir/app/computer/\(taskId)", request); await load() }
        catch { self.error = error.displayMessage }
    }
}
