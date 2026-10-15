import XCTest
@testable import LakesideCore

final class WorkSyncTests: XCTestCase {
    func testSnapshotPreservesOfflineIntent() throws {
        var cache = WorkCache()
        let intent = WorkIntent(boardID: "studio", type: "comment.add", payload: ["text": .string("Keep this comment")])
        cache.pending.append(intent)
        cache.replace(boardID: "studio", snapshot: try JSONValue.parse(#"{"epoch":"new","eventsCursor":0,"cards":[]}"#))
        let restored = try JSONDecoder().decode(WorkCache.self, from: JSONEncoder().encode(cache))
        XCTAssertEqual(restored.pending, [intent])
        XCTAssertEqual(restored.pending[0].body["commandId"], .string(intent.id))
    }
    func testEpochResetDoesNotAdvanceCursor() throws {
        var cache = WorkCache()
        cache.replace(boardID: "b", snapshot: try JSONValue.parse(#"{"epoch":"old","eventsCursor":50,"cards":[]}"#))
        XCTAssertFalse(cache.apply(boardID: "b", changes: try JSONValue.parse(#"{"epoch":"new","cursor":1,"events":[]}"#)))
        XCTAssertEqual(cache.snapshots["b"]?["eventsCursor"], .number(50))
    }
    func testReceiptDoesNotSkipOtherCardsEventsOrRollBackNewerCard() throws {
        var cache = WorkCache()
        cache.replace(boardID: "b", snapshot: try JSONValue.parse(#"{"epoch":"e","eventsCursor":2,"cards":[]}"#))
        let intent = WorkIntent(boardID: "b", type: "card.create", payload: ["title": .string("one")])
        cache.pending.append(intent)
        cache.acknowledge(intent, receipt: try JSONValue.parse(#"{"status":"accepted","eventsCursor":5,"card":{"id":"a","version":3,"title":"new"}}"#))
        XCTAssertEqual(cache.snapshots["b"]?["eventsCursor"], .number(2))
        XCTAssertTrue(cache.pending.isEmpty)
        XCTAssertTrue(cache.apply(boardID: "b", changes: try JSONValue.parse(#"{"epoch":"e","cursor":5,"events":[{"seq":3,"card":{"id":"b","version":1}},{"seq":4,"card":{"id":"a","version":2,"title":"old"}}]}"#)))
        let cards = cache.snapshots["b"]?["cards"].array ?? []
        XCTAssertEqual(cards.count, 2)
        XCTAssertEqual(cards.first { $0["id"].string == "a" }?["title"], .string("new"))
    }
    func testMoveUsesIndependentPositionRevisionAndNeverClaimsApproval() throws {
        let card = try JSONValue.parse(#"{"id":"card","version":12,"positionVersion":3}"#)
        let intent = WorkIntent(boardID: "b", type: "card.move", card: card, payload: ["columnId": .string("approved")])
        XCTAssertEqual(intent.body["basePositionVersion"], .number(3))
        XCTAssertEqual(intent.body["baseVersion"], .number(12))
        XCTAssertFalse(intent.authority)
        XCTAssertNil(intent.body["actor"])
    }
    func testBoardConfigurationRequiresResnapshot() throws {
        var cache = WorkCache()
        cache.replace(boardID: "b", snapshot: try JSONValue.parse(#"{"epoch":"e","eventsCursor":1,"cards":[]}"#))
        XCTAssertFalse(cache.apply(boardID: "b", changes: try JSONValue.parse(#"{"epoch":"e","cursor":2,"events":[{"seq":2,"type":"board.configured"}]}"#)))
    }
}
