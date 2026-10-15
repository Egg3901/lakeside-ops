import SwiftUI
import UserNotifications
import LakesideCore

/// Everything the owner watches, from the ops dashboard and Keir.
@MainActor final class OpsStore: ObservableObject {
    @Published var services: [JSONValue] = []
    @Published var hub: JSONValue = .null
    @Published var kanban: JSONValue = .null
    @Published var host: JSONValue = .null
    @Published var decisions: [JSONValue] = []
    @Published var alerts: [JSONValue] = []
    @Published var updated: Date?
    @Published var error: String?
    @Published var loading = false

    var kpis: JSONValue { hub["kpis"] }
    var servicesDown: [JSONValue] { services.filter { !["operational", ""].contains($0["current"].string) } }
    var redPRs: Int { Int(kpis["prsRed"].number ?? 0) }
    var blocked: [JSONValue] { kanban["blocked"].array }
    var needsOwner: [JSONValue] { kanban["needs_owner"].array }
    /// The count on the Pulse tab badge: only things the owner can act on now.
    var attention: Int { decisions.count + servicesDown.count + redPRs }

    func refresh(_ session: AppSession) async {
        guard !loading else { return }
        loading = true; defer { loading = false }
        async let status = try? session.get("/api/status")
        async let keir = try? session.get("/api/keir/hub")
        async let board = try? session.get("/api/kanban/brief")
        async let scheduler = try? session.get("/api/scheduler")
        async let open = try? session.get("/api/keir/app/decisions")
        async let feed = try? session.get("/api/keir/app/alerts")
        let (s, k, b, h, d, a) = await (status, keir, board, scheduler, open, feed)
        if let s { services = s["services"].array }
        if let k { hub = k }
        if let b { kanban = b }
        if let h { host = h["host"] }
        if let d { decisions = d["decisions"].array }
        if let a { alerts = a["alerts"].array }
        let failed = [s, k, b, h, d, a].filter { $0 == nil }.count
        error = failed == 6 ? "Ops is unreachable. Pull to retry." : failed > 0 ? "Some panels could not refresh." : nil
        if failed < 6 { updated = Date() }
        UNBadge.set(attention)
    }

    func answer(_ id: String, verdict: String, text: String = "", _ session: AppSession) async -> Bool {
        do {
            _ = try await session.post("/api/keir/app/decisions/\(id)", ["verdict": .string(verdict), "text": .string(text)])
            decisions.removeAll { $0["id"].string == id }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            UNBadge.set(attention)
            return true
        } catch { self.error = error.displayMessage; UINotificationFeedbackGenerator().notificationOccurred(.error); return false }
    }
}

/// Keir's private thread with the owner.
@MainActor final class KeirStore: ObservableObject {
    @Published var messages: [JSONValue] = []
    @Published var tasks: [JSONValue] = []
    @Published var working = false
    @Published var connected = false
    @Published var sending = false
    @Published var error: String?
    @Published var thread = "main"
    @Published var threads: [JSONValue] = []
    @Published var queued = 0
    @Published var questions: [JSONValue] = []
    @Published var backgroundTasks: [JSONValue] = []
    @Published var models: [JSONValue] = []
    @Published var modelSelection = "auto"
    @Published var selectingModel = false
    @Published var controls: JSONValue = .null
    @Published var controlling = false
    var stopped: Bool { controls["stopped"].bool }
    var yolo: Bool { controls["approvalMode"].string == "yolo" }
    func loadControls(_ session: AppSession) async {
        let selected = thread
        do {
            let result = try await session.get("/api/keir/app/controls", query: ["thread": selected])
            if thread == selected { controls = result }
        } catch { if controls != .null { self.error = error.displayMessage } }
    }
    func control(_ fields: [String: JSONValue], _ session: AppSession) async {
        guard !controlling else { return }
        controlling = true; defer { controlling = false }
        let selected = thread
        do {
            var body = fields; body["thread"] = .string(selected)
            let result = try await session.post("/api/keir/app/controls", body)
            guard thread == selected else { return }
            controls = result; error = nil
            UINotificationFeedbackGenerator().notificationOccurred(stopped ? .warning : .success)
        } catch { self.error = error.displayMessage; UINotificationFeedbackGenerator().notificationOccurred(.error) }
    }

    @Published var sendMode = "new"
    @Published var steeringTask: String?
    private var cursor = 0
    private var version = ""
    private var pending: (text: String, thread: String, mode: String, task: String?, id: String)?

    var live: [JSONValue] { tasks.filter { !["done", "cancelled", "dismissed"].contains($0["state"].string) } }

    func connect(_ session: AppSession) async {
        var delay = 1.0
        while !Task.isCancelled {
            do {
                // The first read returns at once; after that the server holds the
                // request until the thread or a task changes (25s at most).
                let selected = thread
                let view = try await session.get("/api/keir/app/thread", query: ["after": String(cursor), "wait": version.isEmpty ? "0" : "25", "since": version, "thread": selected])
                guard selected == thread else { continue }
                let before = version
                apply(view); connected = true; error = nil; delay = 1
                // A server that answers without waiting must not turn this into a busy loop.
                if version == before { try await Task.sleep(for: .seconds(2)) }
            } catch {
                if Task.isCancelled { return }
                connected = false; self.error = error.displayMessage
                do { try await Task.sleep(for: .seconds(delay)) } catch { return }
                delay = min(20, delay * 2)
            }
        }
    }

    private func apply(_ view: JSONValue) {
        let fresh = view["messages"].array.filter { m in !messages.contains { $0["id"] == m["id"] } }
        if !fresh.isEmpty {
            messages.append(contentsOf: fresh)
            if fresh.contains(where: { $0["role"].string == "keir" }) { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
        }
        if view["controls"] != .null { controls = view["controls"] }
        tasks = view["tasks"].array
        working = view["working"].bool
        queued = Int(view["queued"].number ?? 0)
        questions = view["questions"].array
        backgroundTasks = view["backgroundTasks"].array
        if !view["modelSelection"].string.isEmpty { modelSelection = view["modelSelection"].string }
        if let target = steeringTask, !live.contains(where: { $0["id"].string == target }) { steeringTask = nil; sendMode = "new" }
        cursor = Int(view["cursor"].number ?? Double(cursor))
        version = view["version"].string
        let snapshot = view["activity"]
        Task { await KeirLiveActivity.shared.sync(snapshot, session: OpsServices.shared.session) }
    }

    func send(_ text: String, _ session: AppSession) async -> Bool {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !sending else { return false }
        sending = true; defer { sending = false }
        let selected = thread, mode = sendMode, target = steeringTask
        if pending?.text != body || pending?.thread != selected || pending?.mode != mode || pending?.task != target {
            pending = (body, selected, mode, target, UUID().uuidString)
        }
        do {
            let result = try await session.post("/api/keir/app/messages", ["text": .string(body), "clientId": .string(pending!.id), "thread": .string(selected), "mode": .string(mode), "taskId": target.map(JSONValue.string) ?? .null])
            pending = nil; error = nil
            guard thread == selected else { return true }
            steeringTask = nil; sendMode = "new"
            if let created = result["thread"].string.nonempty { await loadThreads(session); select(created); return true }
            if result["controls"] != .null { controls = result["controls"] }
            let message = result["message"]
            if message != .null, !messages.contains(where: { $0["id"] == message["id"] }) { messages.append(message); cursor = max(cursor, Int(message["seq"].number ?? 0)) }
            return true
        } catch { self.error = error.displayMessage; return false }
    }

    /// Switches the visible thread; the connection loop restarts on the new one.
    func select(_ id: String) {
        guard id != thread else { return }
        steeringTask = nil; sendMode = "new"; modelSelection = "auto"
        controls = .null; thread = id; questions = []; messages = []; tasks = []; cursor = 0; version = ""; queued = 0; working = false
    }
    func loadModels(_ session: AppSession) async {
        let selected = thread
        do {
            let result = try await session.get("/api/keir/app/models", query: ["thread": selected])
            guard selected == thread else { return }
            models = result["models"].array; modelSelection = result["selection"].string.nonempty ?? "auto"
        } catch { models = []; self.error = error.displayMessage }
    }
    func selectModel(_ id: String, _ session: AppSession) async {
        guard !selectingModel else { return }
        selectingModel = true; defer { selectingModel = false }
        let selected = thread
        do {
            let result = try await session.post("/api/keir/app/models", ["thread": .string(selected), "selection": .string(id)])
            guard selected == thread else { return }
            modelSelection = result["selection"].string; error = nil
        } catch { self.error = error.displayMessage }
    }
    var modelLabel: String { models.first { $0["id"].string == modelSelection }?["label"].string ?? "Auto" }

    func loadThreads(_ session: AppSession) async {
        if let list = try? await session.get("/api/keir/app/threads") { threads = list["threads"].array }
    }
    func newThread(_ title: String, _ session: AppSession) async {
        do { let made = try await session.post("/api/keir/app/threads", ["title": .string(title)]); await loadThreads(session); select(made["id"].string) }
        catch { self.error = error.displayMessage }
    }
    var threadTitle: String { threads.first { $0["id"].string == thread }?["title"].string ?? (thread == "watches" ? "Watches" : "Keir") }

    func stop(_ task: String, _ session: AppSession) async {
        do { _ = try await session.post("/api/keir/app/cancel", ["taskId": .string(task)]); tasks.removeAll { $0["id"].string == task } }
        catch { self.error = error.displayMessage }
    }
}

enum UNBadge {
    static func set(_ count: Int) { UNUserNotificationCenter.current().setBadgeCount(count) { _ in } }
}
