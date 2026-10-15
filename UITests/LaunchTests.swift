import XCTest

/// Lakeside Ops UI tests. Every test runs against built-in fixtures and never
/// contacts a server. Rows that are buttons or navigation links expose one
/// combined label, so lookups match on label text rather than exact static text.
final class LaunchTests: XCTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures"]; app.launch()
        XCTAssertTrue(app.tabBars.buttons["Keir"].waitForExistence(timeout: 15))
        return app
    }
    private func find(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }

    func testKeirThreadDecisionAndReply() {
        let app = launch()
        XCTAssertTrue(find(app, "How did the last turn go?").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["decision-approve"].waitForExistence(timeout: 10))
        capture(app, "Keir thread with a decision")
        let composer = app.textFields["keir-composer"].exists ? app.textFields["keir-composer"] : app.textViews["keir-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5)); composer.tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { composer.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.typeText("Which PRs are waiting on me?")
        app.buttons["keir-send"].tap()
        XCTAssertTrue(find(app, "Two PRs are waiting on you").waitForExistence(timeout: 15))
        capture(app, "Keir reply")
        app.buttons["decision-approve"].tap()
        XCTAssertFalse(app.buttons["decision-approve"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.webViews.count, 0)
    }

    func testActivityAndTaskDetail() {
        let app = launch()
        app.tabBars.buttons["Activity"].tap()
        let task = find(app, "Promote development to production")
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        capture(app, "Activity")
        task.tap()
        XCTAssertTrue(find(app, "Merged PR #210").waitForExistence(timeout: 10))
        XCTAssertTrue(find(app, "Waiting for the main deploy").exists)
        capture(app, "Task with steps and receipts")
    }

    func testWatchesMemoryAndThreads() {
        let app = launch()
        app.buttons["keir-tools"].tap(); app.buttons["Watches"].tap()
        XCTAssertTrue(find(app, "PR 201 is merged").waitForExistence(timeout: 10))
        capture(app, "Watches")
        app.buttons["watch-add"].tap()
        let condition = app.textViews["watch-condition"].exists ? app.textViews["watch-condition"] : app.textFields["watch-condition"]
        XCTAssertTrue(condition.waitForExistence(timeout: 5)); condition.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.typeText("Turn time goes above 90 seconds")
        app.buttons["watch-save"].tap()
        XCTAssertTrue(find(app, "Turn time goes above 90 seconds").waitForExistence(timeout: 10))
        app.buttons["Done"].firstMatch.tap()

        app.buttons["keir-tools"].tap(); app.buttons["Memory"].tap()
        XCTAssertTrue(find(app, "Never promote economy changes").waitForExistence(timeout: 10))
        capture(app, "Memory")
        app.buttons["Done"].firstMatch.tap()

        app.buttons["keir-tools"].tap(); app.buttons["Ideas"].tap()
        XCTAssertTrue(find(app, "CI runs the full matrix").waitForExistence(timeout: 10))
        capture(app, "Ideas")
        app.buttons["Done"].firstMatch.tap()

        app.buttons["keir-threads"].tap()
        XCTAssertTrue(find(app, "Bond market").waitForExistence(timeout: 10))
        capture(app, "Threads")
    }

    func testPulseDeskAndWork() {
        let app = launch()
        app.tabBars.buttons["Pulse"].tap()
        XCTAssertTrue(find(app, "Lakeside Ask is degraded").waitForExistence(timeout: 10))
        capture(app, "Pulse")
        app.swipeUp(); capture(app, "Pulse services and activity")
        app.tabBars.buttons["Desk"].tap()
        let ticket = find(app, "Budget screen shows zero funding")
        XCTAssertTrue(ticket.waitForExistence(timeout: 10))
        capture(app, "Desk")
        ticket.tap()
        XCTAssertTrue(find(app, "Funding display fix").waitForExistence(timeout: 10))
        capture(app, "Ticket detail")
        app.tabBars.buttons["Work"].tap()
        XCTAssertTrue(find(app, "Keir chat in Lakeside Ops").waitForExistence(timeout: 10))
        capture(app, "Work")
    }

    func testNativeSignInAndCancellation() {
        let app = XCUIApplication(); app.launch()
        let signIn = app.buttons["Sign in to Lakeside"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 15))
        XCTAssertEqual(app.webViews.count, 0)
        capture(app, "Sign in")
        signIn.tap()
        let cancel = app.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 10))
        cancel.tap()
        XCTAssertTrue(signIn.waitForExistence(timeout: 5))
        XCTAssertEqual(app.webViews.count, 0)
    }
}
