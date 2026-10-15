import Foundation

public struct WorkIntent: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var boardID: String
    public var body: [String: JSONValue]
    public var issue: String?
    public var authority: Bool
    public init(boardID: String, type: String, card: JSONValue = .null, payload: [String: JSONValue], authority: Bool = false) {
        id = UUID().uuidString; self.boardID = boardID; self.authority = authority
        body = ["commandId": .string(id), "type": .string(type), "payload": .object(payload)]
        if card["id"] != .null { body["cardId"] = card["id"]; body["baseVersion"] = card["version"]; body["basePositionVersion"] = card["positionVersion"] }
    }
}

/// Confirmed records and local intent remain separate, including across snapshot replacement.
public struct WorkCache: Codable, Sendable {
    public var boards: [JSONValue] = []
    public var snapshots: [String: JSONValue] = [:]
    public var details: [String: JSONValue] = [:]
    public var pending: [WorkIntent] = []
    public var refreshedAt: [String: Date] = [:]
    public init() {}
    public mutating func replace(boardID: String, snapshot: JSONValue) {
        snapshots[boardID] = snapshot; refreshedAt[boardID] = Date()
    }
    public mutating func apply(boardID: String, changes: JSONValue) -> Bool {
        guard var fields = snapshots[boardID]?.object, fields["epoch"] == changes["epoch"], !changes["resync"].bool else { return false }
        var cards = fields["cards"]?.array ?? []
        let cursor = fields["eventsCursor"]?.number ?? 0
        for event in changes["events"].array where (event["seq"].number ?? 0) > cursor {
            if event["type"].string.hasPrefix("board.") { return false }
            let card = event["card"]
            if card["id"] != .null {
                if let current = cards.first(where: { $0["id"] == card["id"] }), (current["version"].number ?? 0) > (card["version"].number ?? 0) { continue }
                cards.removeAll { $0["id"] == card["id"] }; cards.append(card)
            }
        }
        fields["cards"] = .array(cards); fields["eventsCursor"] = changes["cursor"]
        snapshots[boardID] = .object(fields); refreshedAt[boardID] = Date(); return true
    }
    public mutating func acknowledge(_ intent: WorkIntent, receipt: JSONValue) {
        guard receipt["status"].string == "accepted" else { return }
        pending.removeAll { $0.id == intent.id }
        if receipt["board"]["id"] != .null {
            boards.removeAll { $0["id"] == receipt["board"]["id"] }; boards.append(receipt["board"])
        }
        if var fields = snapshots[intent.boardID]?.object, receipt["card"]["id"] != .null {
            var cards = fields["cards"]?.array ?? []
            if let current = cards.first(where: { $0["id"] == receipt["card"]["id"] }), (current["version"].number ?? 0) > (receipt["card"]["version"].number ?? 0) { return }
            cards.removeAll { $0["id"] == receipt["card"]["id"] }; cards.append(receipt["card"])
            fields["cards"] = .array(cards); snapshots[intent.boardID] = .object(fields)
            // Do not advance the board cursor: intervening events still need replay.
        }
    }
}
