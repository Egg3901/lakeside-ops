#if DEBUG
import Foundation

/// Isolated UI-test transport. It never contacts a server and is absent in Release.
final class FixtureProtocol: URLProtocol, @unchecked Sendable {
    private final class RoutingState: @unchecked Sendable {
        let lock = NSLock()
        var selection: [String: Any] = ["provider": "auto", "model": NSNull(), "effort": "auto", "allowFallback": true]
        func access(_ update: [String: Any]? = nil) -> [String: Any] {
            lock.lock(); defer { lock.unlock() }
            if let update { selection = update }
            return selection
        }
    }
    private static let routing = RoutingState()
    private final class CompanyState: @unchecked Sendable {
        let lock = NSLock()
        var jobs: [[String: Any]] = [["id": "job-1", "title": "Fix export failures", "objective": "Make exports reliable for every project.", "status": "detected", "column": "todo", "board_rank": 100, "entity_id": "project-1", "staff_id": "staff-1", "version": 1, "task_type": "bugfix", "artifact": "fixture-commit-abc", "acceptance": ["Empty exports complete successfully"], "contract": ["investigate": true, "draft": true, "change": false, "merge": false, "deploy": false, "communicate": false], "conversation_id": 1]]
        var checks: [[String: Any]] = []
        var requests: Set<String> = []
        func route(_ path: String, method: String, body: [String: Any]) -> (Any, Int) {
            lock.lock(); defer { lock.unlock() }
            let project: [String: Any] = ["id": "project-1", "kind": "product", "title": "Studio hub", "summary": "Studio tools", "source": "UI fixture"]
            if path == "/api/ops/company" { return (["missions": jobs, "boardColumns": [["id": "todo", "title": "To do"], ["id": "doing", "title": "In progress"], ["id": "review", "title": "Needs review"], ["id": "ready", "title": "Ready to ship"], ["id": "watching", "title": "Watching"], ["id": "done", "title": "Done"]], "entities": [project], "links": [], "counts": ["active": jobs.count, "needsOwner": 1, "monitoring": 0, "verified": 0], "automation": ["enabled": false, "description": "External sources are not connected."]], 200) }
            if path == "/api/ops/company/sync" { return (["imported": 1], 200) }
            if path == "/api/ops/company/signals" {
                guard let key = body["requestId"] as? String, let title = body["title"] as? String else { return (["error": "Missing work request"], 400) }
                if requests.contains(key) { return (["mission": jobs.last ?? [:], "duplicate": true], 200) }
                var job = jobs[0]; job["id"] = "job-\(jobs.count + 1)"; job["title"] = title; job["objective"] = body["objective"]; job["acceptance"] = body["acceptance"]; job["status"] = "detected"; job["version"] = 1
                jobs.append(job); requests.insert(key)
                return (["mission": job, "duplicate": false], 200)
            }
            let pieces = path.split(separator: "/").map(String.init)
            guard pieces.count >= 5, let index = jobs.firstIndex(where: { $0["id"] as? String == pieces[4] }) else { return (["error": "Work not found"], 404) }
            if method == "GET" {
                return (["mission": jobs[index], "events": [["id": "event-1", "type": "detected", "detail": "Export failures reported by support.", "created_at": "2026-09-09T12:00:00Z"]], "evidence": checks, "assignments": [], "signal": ["summary": "Several projects could not export their files.", "source": "support", "observed_at": "2026-09-09T12:00:00Z"]], 200)
            }
            guard pieces.count == 6, body["version"] as? Int == jobs[index]["version"] as? Int else { return (["error": "This work changed. Reload before saving."], 409) }
            switch pieces[5] {
            case "move":
                guard let target = body["column"] as? String, ["todo", "doing", "review"].contains(target) else { return (["error": "Complete the required checks before moving here."], 409) }
                jobs[index]["column"] = target
                jobs[index]["status"] = target == "doing" ? "working" : target == "review" ? "awaiting_verification" : "detected"
            case "evidence":
                var check = body; check["id"] = "check-\(checks.count + 1)"; checks.append(check)
            case "verify": checks.append(["id": "github-check-1", "kind": "test", "summary": "GitHub checks passed for the recorded version.", "artifact": body["artifact"] ?? "", "passed": true, "source": "github"])
            case "contract": jobs[index]["contract"] = body["contract"]
            case "artifact": jobs[index]["artifact"] = body["artifact"]
            case "assign": jobs[index]["status"] = "investigating"
            case "approve": jobs[index]["status"] = "approved"
            case "monitor": jobs[index]["status"] = "monitoring"
            case "finish": jobs[index]["status"] = "verified"; jobs[index]["completion_mode"] = "reviewed"
            case "reopen": jobs[index]["status"] = "investigating"
            case "cancel": jobs[index]["status"] = "cancelled"
            default: return (["error": "Unknown action"], 404)
            }
            jobs[index]["version"] = (jobs[index]["version"] as? Int ?? 0) + 1
            return (["mission": jobs[index]], 200)
        }
    }
    private static let company = CompanyState()
    private final class WatchState: @unchecked Sendable {
        let lock = NSLock()
        var watches: [[String: Any]] = [
            ["id": 7, "kind": "fx", "label": "USD/GBP crosses above 1.30", "createdAt": 1788825600000, "lastFiredAt": NSNull()],
            ["id": 8, "kind": "war", "label": "new war activity involving FR", "createdAt": 1788825600000, "lastFiredAt": 1788912000000],
        ]
        func list() -> [String: Any] { lock.lock(); defer { lock.unlock() }; return ["watches": watches, "limit": 5] }
        func delete(_ id: Any?) -> Bool {
            lock.lock(); defer { lock.unlock() }
            func normalized(_ value: Any?) -> String {
                if let number = value as? NSNumber { return String(number.int64Value) }
                return value.map { "\($0)" } ?? ""
            }
            let key = normalized(id)
            let before = watches.count
            watches.removeAll { normalized($0["id"]) == key }
            return watches.count < before
        }
    }
    private static let watchState = WatchState()
    private static let work = WorkFixture()
    private final class KeirState: @unchecked Sendable {
        let lock = NSLock()
        var messages: [[String: Any]] = [
            ["seq": 1, "id": "app-1", "role": "owner", "text": "How did the last turn go?", "at": 1792020000000],
            ["seq": 2, "id": "app-2", "role": "keir", "text": "Turn 202 ran clean in 41s. One warning: index fund settlement for one corporation, already tracked in an issue.", "at": 1792020060000]]
        var decisions: [[String: Any]] = [["id": "abcdefabcdef", "question": "Merge PR #201 into development? Checks are green.", "tldr": "Merge #201 to development", "at": 1792020000000, "ticket": NSNull(), "signoff": false]]
        func thread(after: Int) -> [String: Any] {
            lock.lock(); defer { lock.unlock() }
            return ["cursor": messages.count, "version": "v\(messages.count)", "messages": messages.filter { ($0["seq"] as? Int ?? 0) > after }, "tasks": [] as [Any], "working": false]
        }
        func post(_ text: String) -> [String: Any] {
            lock.lock(); defer { lock.unlock() }
            let owner: [String: Any] = ["seq": messages.count + 1, "id": "app-\(messages.count + 1)", "role": "owner", "text": text, "at": 1792020100000]
            messages.append(owner)
            messages.append(["seq": messages.count + 1, "id": "app-\(messages.count + 1)", "role": "keir", "text": "Two PRs are waiting on you: #201 and #202.", "at": 1792020110000])
            return ["message": owner, "jobId": "job-1"]
        }
        func answer(_ id: String) -> [String: Any] { lock.lock(); defer { lock.unlock() }; decisions.removeAll { $0["id"] as? String == id }; return ["id": id, "state": "approve"] }
        func open() -> [[String: Any]] { lock.lock(); defer { lock.unlock() }; return decisions }
    }
    private static let keir = KeirState()

    private func bodyObject() -> [String: Any]? {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(contentsOf: buffer.prefix(count))
            }
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        if ["/api/ops/boards", "/api/ops/cards", "/api/ops/commands", "/api/ops/runners", "/api/ops/runs"].contains(where: { url.path.hasPrefix($0) }) {
            let (value, status) = Self.work.route(url, method: request.httpMethod ?? "GET", body: bodyObject() ?? [:])
            deliver((try? JSONSerialization.data(withJSONObject: value)) ?? Data(), url: url, status: status, type: "application/json")
            return
        }
        if url.path.hasPrefix("/api/ops/company") {
            let (value, status) = Self.company.route(url.path, method: request.httpMethod ?? "GET", body: bodyObject() ?? [:])
            deliver((try? JSONSerialization.data(withJSONObject: value)) ?? Data(), url: url, status: status, type: "application/json")
            return
        }
        let isAsk = url.host?.hasPrefix("ask.") == true
        var value: Any = ["error": "No test fixture for this endpoint"]
        var status = 200
        switch url.path {
        case "/api/me":
            let expectedNames = isAsk ? ["__Host-lakeside_session", "__Host-ask_session"] : [url.host?.hasPrefix("hub.") == true ? "agency_session" : "ops_session"]
            let cookie = request.value(forHTTPHeaderField: "Cookie") ?? ""
            guard expectedNames.contains(where: { name in
                ["ui-test-session", "fixture-login"].contains(where: { cookie == name + "=" + $0 })
            }) else {
                deliver(Data("{\"error\":\"Fixture requires session cookie\"}".utf8), url: url, status: 401, type: "application/json"); return
            }
            if isAsk {
                let usage: [String: Any] = ["used": 46.5, "limit": 200, "remaining": 153.5, "mcpLimit": 40, "mcpRemaining": 12, "vizLimit": 10, "vizRemaining": 8, "resetAt": 1788912000000, "tier": "Staff"]
                let providers: [[String: Any]] = [
                    ["id": "google", "name": "Google", "detail": "Gemini models"],
                    ["id": "deepseek", "name": "DeepSeek", "detail": "DeepSeek models, operated from China"],
                ]
                let profile: [String: Any] = ["identity": ["username": "Test operator"], "entitlement": ["allowed": true, "label": "Staff"], "usage": usage, "aiProviders": providers]
                value = profile
            } else {
                value = ["email": "operator@example.test", "role": "admin"]
            }
        case "/api/keir/app/thread": value = Self.keir.thread(after: Int(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "after" }?.value ?? "0") ?? 0)
        case "/api/keir/app/messages": value = Self.keir.post(bodyObject()?["text"] as? String ?? ""); status = 201
        case "/api/keir/app/decisions": value = ["decisions": Self.keir.open()]
        case "/api/keir/app/decisions/abcdefabcdef": value = Self.keir.answer("abcdefabcdef")
        case "/api/keir/app/alerts": value = ["alerts": [["key": "error:watch-recurring:turn", "kind": "incident", "text": "Turn warning repeated after the fix: index fund settlement for one corporation.", "at": 1792019000000]]]
        case "/api/keir/app/devices": value = ["registered": true]
        case "/api/keir/app/cancel": value = ["state": "cancelled"]
        case "/api/status", "/api/keir/hub", "/api/kanban/brief", "/api/scheduler": value = OpsFixtures.value(url.path)
        case "/api/ops/bootstrap": value = ["cursor": 0, "conversation": ["id": 1], "conversations": [["id": 1, "title": "Build the studio hub"]], "staff": [["id": "staff-1", "name": "Release engineer", "role": "Maintain release quality", "provider": "auto"]], "workers": [["id": "worker-1", "name": "Export repair", "brief": "Repair and verify the export flow.", "job_status": "completed", "runtime_provider": "codex", "permissions": [], "result": "Export fixed. All checks passed."]]]
        case "/api/chat/turns": value = ["turns": [["id": 1, "role": "owner", "body": "Help me build the studio hub.", "status": "done"], ["id": 2, "role": "assistant", "body": "The export worker has finished. I am checking the changes before accepting them.", "status": "done", "route": ["label": "Muse"], "actions": [["name": "bash", "label": "Run export checks", "command": "npm test", "output": "All 12 checks passed", "state": "completed", "exitCode": 0]]]]]
            if ProcessInfo.processInfo.arguments.contains("--uitest-live-activity") {
                value = ["turns": [["id": 1, "role": "owner", "body": "Check the export flow.", "status": "done"], ["id": 2, "role": "assistant", "body": "", "status": "running", "route": ["label": "Codex"], "actions": []]]]
            }
        case "/api/chat/stream/2":
            guard ProcessInfo.processInfo.arguments.contains("--uitest-live-activity") else { status = 404; break }
            let live = "event: action\ndata: {\"id\":\"live-tool\",\"name\":\"bash\",\"label\":\"Running export checks\",\"command\":\"npm test\",\"state\":\"running\"}\n\nevent: status\ndata: {\"label\":\"Running export checks\"}\n\nevent: delta\ndata: {\"text\":\"Checking the export flow.\"}\n\n"
            deliver(Data(live.utf8), url: url, status: 200, type: "text/event-stream", finish: false); return
        case "/api/ops/events":
            deliver(Data(": connected\n\n".utf8), url: url, status: 200, type: "text/event-stream", finish: false); return
        case "/api/ops/staff": value = ["staff": [["id": "staff-1", "name": "Release engineer", "role": "Maintain release quality", "provider": "auto"]]]
        case "/api/ops/staff/staff-1": value = ["staff": ["id": "staff-1", "name": "Release engineer", "role": "Maintain release quality", "memory": "Verify exports before release.", "provider": "auto", "version": 1], "runs": [["id": "worker-1", "name": "Export repair", "brief": "Repair exports", "job_status": "completed", "created_at": "2026-09-08T12:00:00.000Z"]]]
        case "/api/ops/projects": value = ["projects": [["name": "Studio hub", "path": "/fixture/studio"]]]
        case "/api/ops/workers/worker-1/messages": value = ["messages": []]
        case "/api/ops/workers/worker-1": value = ["worker": ["brief": "Repair and verify the export flow.", "result": "Export fixed. All checks passed."]]
        case "/api/ops/conversations/1/routing":
            if request.httpMethod == "POST" {
                if let body = bodyObject(), body["provider"] is String, body["effort"] is String, body["allowFallback"] is Bool {
                    value = Self.routing.access(body)
                } else { status = 400; value = ["error": "Routing request body missing"] }
            } else { value = Self.routing.access() }
        case "/api/ops/providers":
            let stamp = Date().timeIntervalSince1970 * 1000
            let definitions: [(String, String)] = [("codex", "Codex"), ("muse", "Muse"), ("grok", "Grok"), ("freerouter", "Free Router")]
            value = ["providers": definitions.map { id, label -> [String: Any] in
                var capacity: [String: Any] = ["status": "available", "source": "UI fixture", "observedAt": stamp, "stale": false, "message": "Quota reported", "windows": [], "balances": []]
                if id == "codex" || id == "grok" {
                    capacity["windows"] = [["id": "quota", "label": id == "codex" ? "5-hour allowance" : "Weekly allowance", "remainingPercent": id == "codex" ? 65 : 18, "resetsAt": stamp + 3600000, "observedAt": stamp]]
                } else if id == "muse" {
                    capacity["status"] = "unavailable"; capacity["message"] = "Account quota not reported"
                } else {
                    capacity["message"] = "Routes ready"; capacity["readiness"] = ["ready": 7, "total": 9, "coolingDown": 2]
                }
                return ["id": id, "label": label, "enabled": true, "status": "available", "billing": id == "freerouter" ? "free" : "subscription", "capabilities": id == "freerouter" ? ["text"] : ["tools"], "models": [["id": "fixture-model", "label": "Fixture model", "isDefault": true, "thinkingOptions": id == "freerouter" ? [] : [["id": "low"], ["id": "medium"], ["id": "high"]]]], "capacity": capacity]
            }]

        case "/api/ops/benchmarks": value = ["scores": [["provider": "codex", "model": "fixture-model", "suite": "coding", "effort": "medium", "passed": 4, "checks": 4, "samples": 1, "latency_ms": 2500]], "runs": []]
        case "/api/ops/usage": value = ["providers": [["provider": "codex", "attempts": 3, "input_tokens": 12000, "output_tokens": 3000, "unmeasured_token_attempts": 1]]]
        case "/api/ops/memory": value = ["body": "Keep each implementation worker in a separate worktree. Verify results before accepting them.", "version": "fixture-version"]
        case "/api/nextcost": value = ["cost": 0.5, "followup": 1, "followupsLeft": 2]
        case "/api/conversation/share": value = ["ok": true, "url": "https://example.test/shared-conversation"]
        case "/api/conversations":
            if isAsk {
                let rows: [[String: Any]] = [["id": "fixture-conversation", "title": "How does inflation work?", "updated": 1788825600000, "pinned": false]]
                if let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "q" })?.value {
                    value = ["conversations": rows.filter { ($0["title"] as? String ?? "").localizedCaseInsensitiveContains(query) || query.localizedCaseInsensitiveContains("prices") }, "query": query]
                } else { value = ["conversations": rows] }
            }
            else { value = ["conversations": [["id": 1, "title": "Build the studio hub"]], "conversation": ["id": 1]] }
        case "/api/ops/workspaces": value = ["workspaces": [["workspaceId": "w1", "title": "Studio hub", "isolation": "worktree"]]]
        case "/api/ops/files": value = ["entries": [["name": "app.swift", "path": "app.swift", "directory": false]]]
        case "/api/ops/files/changes": value = ["entries": [["name": "app.swift", "path": "app.swift", "status": " M", "deleted": false, "untracked": false]]]
        case "/api/ops/files/read": value = ["content": "// Studio hub\nlet version = \"1.3.0\"", "size": 40]
        case "/api/ops/files/diff": value = ["content": "-let version = 1.2\n+let version = 1.3"]
        case "/api/ops/workers/worker-1/activity":
            value = ["content": "Ran export checks. All 12 checks passed.", "entries": [
                ["id": "message-1", "kind": "message", "role": "assistant", "title": "Assistant", "body": "Checking the export implementation."],
                ["id": "tool-1", "kind": "tool", "title": "Run export checks", "body": "npm test\nAll 12 checks passed", "state": "completed"]
            ], "updateCount": 2, "revision": "fixture-worker-v1", "saved": true, "stale": false, "truncated": false, "observedAt": Date().timeIntervalSince1970 * 1000]
        case "/api/ops/workers/worker-1/subagents":
            value = ["subagents": [["id": "child-1", "parentAgentId": "fixture-runtime", "provider": "codex", "title": "Export reviewer", "description": "Review edge cases before accepting the repair.", "status": "completed"]], "saved": true, "stale": false]
        case "/api/ops/workers/worker-1/subagents/child-1/activity":
            value = ["entries": [["id": "child-message-1", "kind": "message", "role": "assistant", "title": "Assistant", "body": "Reviewed empty exports and unicode filenames."]], "content": "Reviewed empty exports and unicode filenames.", "revision": "fixture-child-v1", "updateCount": 1, "saved": true, "stale": false, "truncated": false]

        case "/api/schedules": value = ["schedules": [["id": 1, "title": "Morning review", "brief": "Review overnight activity", "cadence": "daily", "enabled": 1]]]
        case "/api/tasks": value = ["tasks": [["id": 1, "title": "Review deployment", "status": "completed", "brief": "Check the release"]]]
        case "/api/tasks/1": value = ["task": ["id": 1, "status": "completed", "result": "Release verified."]]

        case "/api/games": value = ["games": [["id": "ahd", "name": "A House Divided"]]]
        case "/api/ask/context": value = ["game": ["id": "ahd", "name": "A House Divided", "subject": "a political strategy game"], "context": "SOURCE CODE: inflation is calculated from the price index.", "files": [], "available": true]
        case "/api/map/render":
            let svg = ##"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><rect width="1200" height="760" fill="#111827"/><path d="M100 160 L480 100 L540 500 L180 550 Z" fill="#38bdf8"/><path d="M560 180 L990 130 L1060 580 L600 500 Z" fill="#21c8a0"/><text x="80" y="70" fill="#ffffff" font-size="32">Fixture regions</text></svg>"##
            deliver(Data(svg.utf8), url: url, status: 200, type: "image/svg+xml"); return
        case "/api/conversation": value = ["turns": [["id": 42, "question": "How does inflation work?", "answer": "## Inflation\n\nPrices respond to supply and demand.", "citations": [["label": "Economy reference", "url": "https://example.test/economy"]]]]]
            if ProcessInfo.processInfo.arguments.contains("--uitest-visuals") {
                let answer = #"""
```mermaid
xychart-beta
 title "GDP growth"
 x-axis ["US", "UK", "France"]
 y-axis "Percent" -2 --> 5
 bar [-1.5, 4, 2.2]
```

```ahd-map
{"title":"Fixture regions","scope":"world","metric":"Growth","unit":"%","regions":[{"id":"US","label":"United States","value":2},{"id":"GB","label":"United Kingdom","value":4}]}
```
"""#
                value = ["turns": [["id": 42, "question": "Show the economy", "answer": answer]]]
            }
        case "/api/watches" where isAsk: value = Self.watchState.list()
        case "/api/watches/delete" where isAsk:
            value = ["ok": Self.watchState.delete(bodyObject()?["id"])]
        case "/api/reports" where isAsk:
            value = ["reports": [["token": "fixture-report", "title": "Fixture economy report", "createdAt": 1788825600000, "url": "/r/fixture-report"]]]
        case "/api/ask/stop":
            let body = bodyObject() ?? [:]
            value = ["ok": (body["reqId"] as? String)?.isEmpty == false]
        case "/api/ask" where ProcessInfo.processInfo.arguments.contains("--uitest-quota"):
            status = 429
            value = ["error": "You've used all 200 questions for today.", "quota": true, "usage": ["used": 200, "limit": 200, "remaining": 0]]
        case "/api/ask" where ProcessInfo.processInfo.arguments.contains("--uitest-slow-stream"):
            let partial = "event: meta\ndata: {\"convId\":\"fixture-conversation\",\"reqId\":\"fixture-request\",\"status\":\"Reading sources\"}\n\nevent: delta\ndata: \"A partial draft\"\n\n"
            deliver(Data(partial.utf8), url: url, status: 200, type: "text/event-stream", finish: false); return
        case "/api/ask":
            let body = #"""
event: meta
data: {"convId":"fixture-conversation","reqId":"fixture-request","status":"Reading sources"}

event: delta
data: "A partial draft"

event: done
data: {"convId":"fixture-conversation","answerId":43,"answer":"Verified final answer from the server.","usage":{"used":47,"limit":200,"remaining":153,"mcpLimit":40,"mcpRemaining":11,"vizLimit":10,"vizRemaining":8},"citations":[{"label":"Verified source","url":"https://example.test/source"}]}

"""# + "\n"
            deliver(Data(body.utf8), url: url, status: 200, type: "text/event-stream"); return
        case "/api/status": value = ["services": [["id": "game", "name": "Game server", "current": "operational", "latencyMs": 42, "uptime24h": 99.9, "history": [["date": "2026-09-07", "pct": 99.9]]]]]
        case "/api/game/summary": value = ["turn": 123, "year": 1960, "activePlayers": 42]
        case "/api/code/sessions": value = ["sessions": [["sessionId": "tmux:test-agent", "tmuxName": "test-agent", "title": "Test agent", "statusLine": "Waiting for input", "needsInput": true, "provider": "codex", "usage": ["percent": 72, "direction": "remaining", "detail": "Weekly plan"]]]]
        case "/api/code/tmux/test-agent/capture": value = ["transcript": ["turns": [["user": "Check the deployment", "blocks": [["type": "text", "text": "Deployment checks passed."]]]]]]
        case "/api/code/tmux/test-agent/message": value = ["ok": true, "queued": true]
        case "/api/tickets": value = ["items": [["_id": "ticket-1", "ticketNumber": 123, "title": "Example ticket", "description": "A reproducible issue", "status": "open"]], "page": 1, "totalPages": 1]
        case "/api/logout", "/auth/logout", "/api/answer/feedback": value = ["ok": true]
        default: status = 404
        }
        deliver((try? JSONSerialization.data(withJSONObject: value)) ?? Data(), url: url, status: status, type: "application/json")
    }
    private func deliver(_ data: Data, url: URL, status: Int, type: String, finish: Bool = true) {
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type]) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data); if finish { client?.urlProtocolDidFinishLoading(self) }
    }
    override func stopLoading() {}
}

/// Ops 2.0 fixtures, typed explicitly so the compiler never has to infer them.
enum OpsFixtures {
    static func value(_ path: String) -> [String: Any] {
        switch path {
        case "/api/status": return ["updated": "2026-10-15T02:43:31Z", "services": [service("production", "A House Divided", "operational", 167, 99.85, dip: 21), service("ask", "Lakeside Ask", "degraded", 912, 98.1, dip: 28)]]
        case "/api/keir/hub": return hub()
        case "/api/kanban/brief": return kanban()
        default: return ["host": host()]
        }
    }
    static func service(_ id: String, _ name: String, _ current: String, _ latency: Int, _ uptime: Double, dip: Int) -> [String: Any] {
        var history: [[String: Any]] = []
        for day in 0..<30 { history.append(["date": "d\(day)", "pct": day == dip ? 96.2 : 100.0]) }
        return ["id": id, "name": name, "current": current, "latencyMs": latency, "uptime7d": uptime, "lastChecked": "2026-10-15T02:43:31Z", "history": history]
    }
    static func hub() -> [String: Any] {
        var activity: [[String: Any]] = []
        for hour in 0..<24 {
            let at: Double = 1791946800000 + Double(hour) * 3600000
            activity.append(["at": at, "claude": hour % 3, "codex": 1, "muse": hour % 5, "agy": 0, "other": 0])
        }
        let kpis: [String: Any] = ["live": 6, "running": 2, "openTickets": 3, "prsOpen": 2, "prsRed": 1, "successRate24h": 0.87]
        let worker: [String: Any] = ["id": "w1", "kind": "ticket", "role": "support", "state": "running", "ticket": 1001, "runner": "claude", "model": "claude-opus-5-5",
            "effort": "medium", "rounds": 14, "via": "rust", "updatedAt": 1792020000000.0, "summary": "Verifying the funding fix on main before answering the player."]
        let item: [String: Any] = ["name": "Funding display fix", "stage": "main", "blocked": false, "note": "Live on the main server."]
        let card: [String: Any] = ["status": "Department funding at 0 is intended when its laws cost nothing.", "items": [item]]
        let ticket: [String: Any] = ["number": 1001, "title": "Budget screen shows zero funding", "status": "open", "category": "bug", "createdAt": 1792010000000.0,
            "prs": [101], "decisionPending": false, "active": ["state": "running"], "card": card]
        let empty: [Any] = []
        return ["paused": false, "kpis": kpis, "activity": activity, "workers": [worker], "recent": empty, "tickets": [ticket]]
    }
    static func kanban() -> [String: Any] {
        let needs: [String: Any] = ["id": 1, "title": "Pick the 1991 seed sector mix", "product": "a-house-divided", "lane": "next", "needs_owner": true, "assigned_to": "", "impact": "high", "updated_at": "2026-10-14T20:00:00Z"]
        let now: [String: Any] = ["id": 2, "title": "Keir chat in Lakeside Ops", "product": "a-house-divided", "lane": "now", "assigned_to": "claude", "impact": "medium",
            "progress_summary": "Operator app channel and push are built.", "last_progress_at": "2026-10-15T02:40:00Z"]
        let blocked: [String: Any] = ["id": 3, "title": "Turn worker release gate", "product": "a-house-divided", "lane": "blocked", "assigned_to": "codex", "impact": "high", "updated_at": "2026-10-14T18:00:00Z"]
        let counts: [String: Any] = ["needs_owner": 1, "now": 1, "blocked": 1, "next": 0]
        let empty: [Any] = []
        return ["counts": counts, "needs_owner": [needs], "now": [now], "blocked": [blocked], "next": empty]
    }
    static func host() -> [String: Any] {
        let memory: [String: Any] = ["usedPct": 32], disk: [String: Any] = ["usedPct": 36], checks: [String: Any] = ["running": 0, "queued": 1]
        return ["cpuUsedPct": 21, "load": [4.7, 5.4, 3.7], "memory": memory, "disk": disk, "checks": checks]
    }
}
#endif
