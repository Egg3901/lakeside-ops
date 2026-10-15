import XCTest
@testable import LakesideCore

final class ProtocolTests: XCTestCase {
    private func events(_ input: String) throws -> [SSEEvent] {
        var parser = SSEParser(); return try input.utf8.compactMap { try parser.feed($0) }
    }
    func testServerEventsAndUnicode() throws {
        let stream = ": keepalive\r\nevent: meta\r\ndata: {\"convId\":\"abc123\"}\r\n\r\nevent: delta\ndata: \"Hello 🌊\"\n\nevent: done\ndata: {\"answer\":\"Final answer\"}\n\n"
        let result = try events(stream)
        XCTAssertEqual(result.map(\.name), ["meta", "delta", "done"])
        XCTAssertEqual(try JSONValue.parse(result[1].data).string, "Hello 🌊")
        XCTAssertEqual(try JSONValue.parse(result[2].data)["answer"].string, "Final answer")
    }
    func testMultilineBOMAndBareCR() throws {
        let result = try events("\u{FEFF}event: status\rdata: first\rdata: second\r\rdata: tail\r\r")
        XCTAssertEqual(result.map(\.data), ["first\nsecond", "tail"])
        XCTAssertEqual(result.map(\.name), ["status", "message"])
    }
    func testIncompleteEventIsNotSuccess() throws {
        XCTAssertTrue(try events("event: done\ndata: {}").isEmpty)
        XCTAssertTrue(try events(": heartbeat\n\nevent: delta\n\n").isEmpty)
    }
    func testURLsKeepCredentialsOnOriginAndEscapeUserInput() throws {
        let base = URL(string: "https://ask.example.com")!
        let url = try Endpoint.url(base: base, path: "/api/conversation", query: ["id": "a&next=https://evil.example/🌊"])
        XCTAssertEqual(url.host, base.host)
        XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "a&next=https://evil.example/🌊")
        XCTAssertThrowsError(try Endpoint.url(base: base, path: "//evil.example"))
        XCTAssertNil(Endpoint.link("javascript:alert(1)", base: base))
        XCTAssertNil(Endpoint.link("http://example.com", base: base))
    }
    func testEvolvingServerPayloadPreservesUnknownFields() throws {
        let value = try JSONValue.parse("{\"id\":42,\"citations\":[{\"label\":\"Source\"}],\"future\":null,\"private\":true}")
        XCTAssertEqual(value["id"].string, "42")
        XCTAssertEqual(value["citations"].array.first?["label"].string, "Source")
        XCTAssertTrue(value["private"].bool)
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value)), value)
    }
}
