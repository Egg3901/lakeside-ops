import XCTest
@testable import LakesideCore

final class AllowanceTests: XCTestCase {
    func testFractionalCreditsAndExhaustion() {
        XCTAssertEqual(Allowance(limit: 20, remaining: 3.5).fractionRemaining, 0.175)
        XCTAssertTrue(Allowance(limit: 20, remaining: 3.5).low)
        XCTAssertEqual(Allowance(limit: 20, remaining: 0).fractionRemaining, 0)
    }
    func testUnavailableAndInconsistentReadings() {
        XCTAssertNil(Allowance(limit: nil, remaining: 3).fractionRemaining)
        XCTAssertNil(Allowance(limit: 20, remaining: .nan).fractionRemaining)
        XCTAssertEqual(Allowance(limit: 20, remaining: 25).fractionRemaining, 1)
        XCTAssertEqual(Allowance(limit: 0, remaining: 0).fractionRemaining, 0)
        XCTAssertFalse(Allowance(limit: 0, remaining: 0).low)
    }
}
