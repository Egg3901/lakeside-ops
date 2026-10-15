#if DEBUG
import Foundation

/// Stateful work-v1 transport fixture. Commands enforce revision and receipt semantics.
final class WorkFixture: @unchecked Sendable {
    private let lock = NSLock()
    private let epoch = UUID().uuidString
    private var cursor = 0
    private var snapshotted = false
    private var injectedConflict = false
    private var receipts: [String: [String: Any]] = [:]
    private var events: [[String: Any]] = []
    private var comments: [[String: Any]] = []
    private var artifacts: [[String: Any]] = []
    private var runs: [[String: Any]] = []
    private var boards: [[String: Any]] = [["id": "studio", "name": "Studio", "version": 1, "columns": [
        ["id": "todo", "title": "To do", "category": "queued"], ["id": "doing", "title": "In progress", "category": "active"],
        ["id": "review", "title": "Needs review", "category": "review"], ["id": "ready", "title": "Approved", "category": "queued"],
        ["id": "watching", "title": "Watching", "category": "active"], ["id": "done", "title": "Done", "category": "done"]
    ]]]
    private var cards: [[String: Any]] = [["id": "job-1", "boardId": "studio", "columnId": "todo", "positionVersion": 1, "version": 1, "title": "Fix export failures", "objective": "Make exports reliable for every project.", "status": "detected", "board_rank": 100, "staff_id": "staff-1", "task_type": "analysis", "artifact": "fixture-report-abc", "acceptance": ["Empty exports complete successfully"], "conversation_id": 1]]
    private let actor: [String: Any] = ["id": "fixture-owner", "role": "owner"]

    func route(_ url: URL, method: String, body: [String: Any]) -> (Any, Int) {
        lock.lock(); defer { lock.unlock() }
        let pieces = url.path.split(separator: "/").map(String.init)
        if snapshotted && ProcessInfo.processInfo.arguments.contains("--uitest-work-offline-after-snapshot") { return (["error": "Fixture connection is offline"], 503) }
        if url.path == "/api/ops/boards" {
            if method == "GET" { return (["boards": boards], 200) }
            guard let command = body["commandId"] as? String else { return (["error": "Missing command ID"], 400) }
            if let receipt = receipts[command] { return (receipt, 200) }
            let board: [String: Any] = ["id": "board-\(boards.count + 1)", "name": body["name"] ?? "Board", "version": 1, "columns": body["columns"] ?? []]
            boards.append(board); let result: [String: Any] = ["board": board]; receipts[command] = result; return (result, 200)
        }
        if pieces.count == 4 && pieces[2] == "commands" { return receipts[pieces[3]].map { ($0 as Any, 200) } ?? (["error": "Command not found"], 404) }
        if url.path == "/api/ops/runners" {
            let provider: [String: Any] = ["id": "codex", "available": true, "models": [["id": "fixture-model"]]]
            return (["runners": [["id": "runner-1", "name": "Studio PC", "kind": "windows", "online": true, "providers": [provider], "workspaces": [["id": "desktop", "name": "Desktop workspace"]]]], "cloud": ["id": "cloud", "name": "Cloud", "providers": [provider], "workspaces": [["id": "studio", "name": "Studio workspace"]]]], 200)
        }
        if pieces.count == 4 && pieces[2] == "runs", let run = runs.first(where: { $0["id"] as? String == pieces[3] }) {
            return (["run": run, "events": [["id": "run-event-1", "kind": "status", "text": "Run accepted with read-only access"]]], 200)
        }
        if pieces.count >= 4 && pieces[2] == "cards", let card = cards.first(where: { $0["id"] as? String == pieces[3] }) {
            let id = pieces[3]
            return (["card": card, "events": events.filter { $0["cardId"] as? String == id }, "comments": comments.filter { $0["cardId"] as? String == id }, "artifacts": artifacts.filter { $0["cardId"] as? String == id }, "runs": runs.filter { $0["cardId"] as? String == id }], 200)
        }
        guard pieces.count == 5, pieces[2] == "boards", let boardIndex = boards.firstIndex(where: { $0["id"] as? String == pieces[3] }) else { return (["error": "Unknown work endpoint"], 404) }
        let boardID = pieces[3]
        if pieces[4] == "snapshot" {
            snapshotted = true
            return (["board": boards[boardIndex], "cards": cards.filter { $0["boardId"] as? String == boardID }, "eventsCursor": cursor, "epoch": epoch, "nextCursor": NSNull(), "counts": [:]], 200)
        }
        if pieces[4] == "changes" {
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let after = Int(query.first { $0.name == "after" }?.value ?? "0") ?? 0
            return (["events": events.filter { ($0["seq"] as? Int ?? 0) > after && $0["boardId"] as? String == boardID }, "cursor": cursor, "epoch": epoch, "hasMore": false, "resync": query.first { $0.name == "epoch" }?.value != epoch], 200)
        }
        guard pieces[4] == "commands", let command = body["commandId"] as? String, let type = body["type"] as? String, let payload = body["payload"] as? [String: Any] else { return (["error": "Invalid command"], 400) }
        if let receipt = receipts[command] { return (receipt, 200) }
        if type == "board.configure" {
            guard body["baseVersion"] as? Int == boards[boardIndex]["version"] as? Int else { return (["error": "Board changed"], 409) }
            boards[boardIndex]["version"] = (boards[boardIndex]["version"] as? Int ?? 0) + 1
            for field in ["name", "columns", "archived"] { if let value = payload[field] { boards[boardIndex][field] = value } }
            let result: [String: Any] = ["commandId": command, "status": "accepted", "board": boards[boardIndex], "eventsCursor": cursor]
            receipts[command] = result; return (result, 200)
        }
        var index: Int
        if type == "card.create" {
            let card: [String: Any] = ["id": "job-\(cards.count + 1)", "boardId": boardID, "columnId": "todo", "positionVersion": 1, "version": 1, "workVersion": 1, "title": payload["title"] ?? "", "objective": payload["objective"] ?? "", "acceptance": payload["acceptance"] ?? ["The result has been reviewed"], "task_type": payload["taskType"] ?? "analysis", "status": "detected", "board_rank": 200]
            cards.append(card); index = cards.count - 1
        } else {
            guard let found = cards.firstIndex(where: { $0["id"] as? String == body["cardId"] as? String }) else { return (["error": "Card not found"], 404) }; index = found
            if type == "card.move" {
                if ProcessInfo.processInfo.arguments.contains("--uitest-work-conflict") && !injectedConflict {
                    injectedConflict = true; cards[index]["columnId"] = "review"; cards[index]["positionVersion"] = 2; cards[index]["version"] = 2
                    publish(type, card: cards[index])
                    return (["error": "Another device moved this card to Needs review.", "code": "position_conflict", "current": cards[index]], 409)
                }
                guard body["basePositionVersion"] as? Int == cards[index]["positionVersion"] as? Int else { return (["error": "Card moved elsewhere", "current": cards[index]], 409) }
                cards[index]["columnId"] = payload["columnId"]; cards[index]["positionVersion"] = (cards[index]["positionVersion"] as? Int ?? 0) + 1
                // Stage changes do not change approval or execution state.
            } else if type == "comment.add" {
                comments.append(["id": "comment-\(comments.count + 1)", "cardId": cards[index]["id"] ?? "", "text": payload["text"] ?? "", "actor": actor])
            } else if type == "card.patch" {
                for (field, value) in payload["changes"] as? [String: Any] ?? [:] { cards[index][field] = value }
            } else if type == "artifact.attach" {
                var item = payload; item["id"] = "artifact-\(artifacts.count + 1)"; item["cardId"] = cards[index]["id"]; artifacts.append(item)
            } else if type == "proposal.decide" {
                guard body["baseVersion"] as? Int == cards[index]["version"] as? Int else { return (["error": "Card changed before review", "current": cards[index]], 409) }
                cards[index]["review"] = ["state": payload["decision"] as? String == "approve" ? "approved" : "rejected", "note": payload["note"] ?? "", "actor": actor, "artifact": cards[index]["artifact"] ?? NSNull()]
            } else if type == "run.dispatch" {
                guard payload["access"] as? String == "read" else { return (["error": "Fixture accepts read-only dispatch only"], 403) }
                runs.append(["id": "run-\(runs.count + 1)", "cardId": cards[index]["id"] ?? "", "hostId": payload["hostId"] ?? "cloud", "provider": payload["provider"] ?? "codex", "status": "queued", "access": "read"])
            } else if type == "run.cancel" {
                if let runIndex = runs.firstIndex(where: { $0["id"] as? String == payload["runId"] as? String }) { runs[runIndex]["status"] = "cancel_requested" }
            } else { return (["error": "Unsupported command"], 400) }
            cards[index]["version"] = (cards[index]["version"] as? Int ?? 0) + 1
        }
        publish(type, card: cards[index])
        let result: [String: Any] = ["commandId": command, "status": "accepted", "card": cards[index], "eventsCursor": cursor]
        receipts[command] = result; return (result, 200)
    }
    private func publish(_ type: String, card: [String: Any]) {
        cursor += 1
        events.append(["seq": cursor, "boardId": card["boardId"] ?? "studio", "cardId": card["id"] ?? "", "type": type, "card": card, "actor": actor, "createdAt": "2026-09-09T12:00:00Z"])
    }
}
#endif
