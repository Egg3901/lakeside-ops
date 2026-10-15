import XCTest
@testable import LakesideCore

final class AskProtocolTests: XCTestCase {
    func testConsentUsesServerListAndFallsBack() throws {
        let profile = try JSONValue.parse(#"{"aiProviders":[{"id":"google","name":"Google","detail":"Gemini models"},{"name":" "}]}"#)
        XCTAssertEqual(AIConsent.recipients(from: profile), [AIRecipient(name: "Google", detail: "Gemini models")])
        XCTAssertEqual(AIConsent.recipients(from: .null), AIConsent.fallback)
        let reordered = [AIRecipient(name: "B", detail: "two"), AIRecipient(name: "A", detail: "one")]
        XCTAssertEqual(AIConsent.signature(reordered), "A|one\nB|two")
        XCTAssertNotEqual(AIConsent.signature(reordered), AIConsent.signature(reordered + [AIRecipient(name: "C", detail: "")]))
    }
    func testMediaTypeAcceptsParameters() {
        XCTAssertTrue(MediaType.isJSON("application/json; charset=utf-8"))
        XCTAssertTrue(MediaType.isJSON("Application/JSON"))
        XCTAssertTrue(MediaType.isJSON("application/problem+json"))
        XCTAssertFalse(MediaType.isJSON("text/html; charset=utf-8"))
        XCTAssertTrue(MediaType.isHTML("text/html; charset=utf-8"))
        XCTAssertTrue(MediaType.isEventStream("text/event-stream; charset=utf-8"))
        XCTAssertFalse(MediaType.isJSON(nil))
    }
    func testFailureClassification() throws {
        XCTAssertEqual(FailureKind.classify(status: 401, payload: .null), .signedOut)
        XCTAssertEqual(FailureKind.classify(status: 429, payload: try JSONValue.parse(#"{"quota":true}"#)), .quotaExhausted)
        XCTAssertEqual(FailureKind.classify(status: 429, payload: .null), .rateLimited)
        XCTAssertEqual(FailureKind.classify(status: 503, payload: .null), .server(503))
        XCTAssertEqual(FailureKind.classify(status: 404, payload: .null), .notFound)
        XCTAssertEqual(FailureKind.classify(status: 400, payload: .null), .rejected(400))
    }
    func testQuestionLimitMatchesJavaScriptLength() {
        XCTAssertEqual(QuestionLimit.count("  hello  "), 5)
        XCTAssertEqual(QuestionLimit.count("🌊"), 2)
        XCTAssertTrue(QuestionLimit.fits(String(repeating: "a", count: 500)))
        XCTAssertFalse(QuestionLimit.fits(String(repeating: "🌊", count: 251)))
        XCTAssertFalse(QuestionLimit.fits("abc "))
    }
    func testClientIDsMatchServerPattern() {
        for _ in 0..<20 {
            XCTAssertTrue(ClientID.isValidConversation(ClientID.make()))
            XCTAssertTrue(ClientID.isValidRequest(ClientID.make(length: 24)))
        }
        XCTAssertTrue(ClientID.isValidRequest(ClientID.make(length: 1)), "Request ids need at least 8 characters")
        XCTAssertFalse(ClientID.isValidConversation("abc"))
        XCTAssertFalse(ClientID.isValidRequest("abcdef1"))
        XCTAssertTrue(ClientID.isValidConversation("abcdef"))
        XCTAssertFalse(ClientID.isValidConversation("abcdef/../x"))
        XCTAssertFalse(ClientID.isValidRequest("ábcdefgh"))
        XCTAssertFalse(ClientID.isValidRequest(String(repeating: "a", count: 65)))
    }
    func testMarkdownExport() {
        let text = ConversationExport.markdown(title: "Inflation", turns: [
            ExportTurn(question: "How does\ninflation work?", answer: "Prices rise.\n", model: "Model · Service",
                       sources: [ExportSource(label: "Economy", url: "https://example.test/e"), ExportSource(label: "", url: "")])
        ], exported: Date(timeIntervalSince1970: 0))
        XCTAssertTrue(text.hasPrefix("# Inflation\n"))
        XCTAssertTrue(text.contains("## How does inflation work?"))
        XCTAssertTrue(text.contains("1. [Economy](https://example.test/e)"))
        XCTAssertTrue(text.contains("2. Source 2"))
        XCTAssertTrue(text.contains("_Answered by Model · Service_"))
        XCTAssertEqual(ConversationExport.fileName("What/is: inflation?"), "What is inflation.md")
        XCTAssertEqual(ConversationExport.fileName("///"), "Lakeside Ask conversation.md")
    }
    func testServerDatesAndNextCost() throws {
        XCTAssertEqual(ServerDate.parse(.number(1000))?.timeIntervalSince1970, 1)
        XCTAssertEqual(ServerDate.parse(.string("2026-10-05T12:00:00Z"))?.timeIntervalSince1970, 1791201600)
        XCTAssertNil(ServerDate.parse(.null))
        let followup = NextCost(try JSONValue.parse(#"{"cost":0.5,"followup":1,"followupsLeft":2}"#))
        XCTAssertEqual(followup.costLabel, "0.5 credits")
        XCTAssertEqual(followup.followupLabel, "Follow-up 1, 2 more at this rate")
        XCTAssertEqual(NextCost(try JSONValue.parse(#"{"cost":1,"followup":0}"#)).costLabel, "1 credit")
        XCTAssertNil(NextCost(.null).costLabel)
    }
    func testStopResultIsOnlyConfirmedByTheServer() throws {
        XCTAssertEqual(StopResult(try JSONValue.parse(#"{"ok":true}"#)), .confirmed)
        XCTAssertEqual(StopResult(try JSONValue.parse(#"{"ok":true,"pending":true}"#)), .pending)
        XCTAssertEqual(StopResult(try JSONValue.parse(#"{"ok":false}"#)), .unconfirmed)
        XCTAssertEqual(StopResult(.null), .unconfirmed)
        XCTAssertTrue(StopResult.pending.discarded)
        XCTAssertFalse(StopResult.unconfirmed.discarded)
    }
    func testJSONAnswerBecomesDoneEvent() {
        let event = SSEEvent(name: "done", data: "{}")
        XCTAssertEqual(event.name, "done")
    }
}
