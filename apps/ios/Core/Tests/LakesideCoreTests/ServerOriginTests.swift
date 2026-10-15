import XCTest
@testable import LakesideCore

final class ServerOriginTests: XCTestCase {
    func testIndependentOrigin() throws {
        let url = try ServerOrigin.url("https://ops.example.com:8443")
        XCTAssertEqual(url.host, "ops.example.com")
        XCTAssertEqual(url.port, 8443)
    }
    func testRejectsCredentialAndPathBearingOrigins() {
        for value in ["http://ops.example.com", "https://user:secret@ops.example.com", "https://ops.example.com/api", "https://ops.example.com?key=secret", "https://ops.example.com#fragment", "garbage"] {
            XCTAssertThrowsError(try ServerOrigin.url(value), value)
        }
    }
}
