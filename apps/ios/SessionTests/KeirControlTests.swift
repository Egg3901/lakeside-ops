import XCTest
import LakesideCore
@testable import LakesideOps

@MainActor final class KeirControlTests: XCTestCase {
    func testSpokenRepliesReadProseWithoutMarkdownOrCode() {
        let input = "## Update\n**Done**: [review the change](https://example.com/private).\n\n```swift\nlet secret = 1\n```"
        let spoken = KeirVoice.spokenText(input)
        XCTAssertTrue(spoken.contains("Done: review the change."))
        XCTAssertTrue(spoken.contains("Code is shown in the conversation."))
        XCTAssertFalse(spoken.contains("https://"))
        XCTAssertFalse(spoken.contains("secret"))
        XCTAssertFalse(spoken.contains("**"))
    }
    func testEmptySpokenReplyAndControlDefaults() {
        XCTAssertEqual(KeirVoice.spokenText("   \n"), "")
        let store = KeirStore()
        XCTAssertFalse(store.stopped); XCTAssertFalse(store.yolo)
        XCTAssertEqual(store.controls, .null)
        XCTAssertTrue(KeirCommand.all.contains { $0.id == "/stop" })
        XCTAssertTrue(KeirCommand.all.contains { $0.id == "/skills" })
    }
}
