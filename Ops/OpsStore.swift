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
    private var cursor = 0
    private var version = ""
    private var pending: (text: String, id: String)?

    var live: [JSONValue] { tasks.filter { $0["state"].string != "done" } }

    func connect(_ session: AppSession) async {
        var delay = 1.0
        while !Task.isCancelled {
            do {
                // The first read returns at once; after that the server holds the
                // request until the thread or a task changes (25s at most).
                let view = try await session.get("/api/keir/app/thread", query: ["after": String(cursor), "wait": version.isEmpty ? "0" : "25", "since": version])
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
        tasks = view["tasks"].array
        working = view["working"].bool
        cursor = Int(view["cursor"].number ?? Double(cursor))
        version = view["version"].string
    }

    func send(_ text: String, _ session: AppSession) async -> Bool {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !sending else { return false }
        sending = true; defer { sending = false }
        if pending?.text != body { pending = (body, UUID().uuidString) }
        do {
            let result = try await session.post("/api/keir/app/messages", ["text": .string(body), "clientId": .string(pending!.id)])
            pending = nil; error = nil
            let message = result["message"]
            if message != .null, !messages.contains(where: { $0["id"] == message["id"] }) { messages.append(message); cursor = max(cursor, Int(message["seq"].number ?? 0)) }
            return true
        } catch { self.error = error.displayMessage; return false }
    }

    func stop(_ task: String, _ session: AppSession) async {
        do { _ = try await session.post("/api/keir/app/cancel", ["taskId": .string(task)]); tasks.removeAll { $0["id"].string == task } }
        catch { self.error = error.displayMessage }
    }
}

enum UNBadge {
    static func set(_ count: Int) { UNUserNotificationCenter.current().setBadgeCount(count) { _ in } }
}
