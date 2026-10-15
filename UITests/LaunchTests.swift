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
    /// Polls the element types that carry text. A descendants(.any) query over the
    /// whole app is slow enough to time out on a loaded CI runner.
    private func find(_ app: XCUIApplication, _ text: String, timeout: TimeInterval = 10) -> XCUIElement {
        let match = NSPredicate(format: "label CONTAINS %@", text)
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            for query in [app.staticTexts, app.buttons, app.cells, app.links] {
                let element = query.matching(match).firstMatch
                if element.exists { return element }
            }
            usleep(300_000)
        } while Date() < deadline
        return app.staticTexts.matching(match).firstMatch
    }
    /// Opens an item from the Keir tools menu, waiting out any closing sheet.
    private func openTool(_ app: XCUIApplication, _ name: String) {
        let tools = app.buttons["keir-tools"]
        for _ in 0..<4 {
            if tools.waitForExistence(timeout: 5) && tools.isHittable { tools.tap() }
            if app.buttons[name].waitForExistence(timeout: 3) { app.buttons[name].tap(); return }
        }
        XCTFail("Keir tools menu did not offer \(name)")
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

    func testFeedWithBriefIdeasAndUpcoming() {
        let app = launch()
        app.tabBars.buttons["Feed"].tap()
        XCTAssertTrue(find(app, "Morning brief").waitForExistence(timeout: 10))
        XCTAssertTrue(find(app, "CI runs the full matrix").waitForExistence(timeout: 10))
        XCTAssertTrue(find(app, "PR 201 is merged").waitForExistence(timeout: 10))
        capture(app, "Feed")
        app.swipeUp(); capture(app, "Feed entries")
        XCTAssertTrue(app.buttons["brief-now"].exists)
    }

    func testGoalsListDetailAndNewGoal() {
        let app = launch()
        app.tabBars.buttons["Goals"].tap()
        let goal = find(app, "Median turn time under 60 seconds")
        XCTAssertTrue(goal.waitForExistence(timeout: 10))
        capture(app, "Goals")
        goal.tap()
        XCTAssertTrue(find(app, "Capture phase timings for 20 turns").waitForExistence(timeout: 10))
        XCTAssertTrue(find(app, "Settlement dominates").exists)
        capture(app, "Goal detail")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["goal-add"].tap()
        let example = app.buttons["Every bug ticket answered within 2 hours"]
        XCTAssertTrue(example.waitForExistence(timeout: 5)); example.tap()
        capture(app, "New goal")
        app.buttons["goal-save"].tap()
        XCTAssertTrue(find(app, "Every bug ticket answered within 2 hours").waitForExistence(timeout: 10))
    }

    func testActivityApprovalsPlanAndLiveWork() {
        let app = launch()
        app.tabBars.buttons["Activity"].tap()
        XCTAssertTrue(find(app, "merge #201").waitForExistence(timeout: 10))
        capture(app, "Activity with approvals")
        let task = find(app, "Promote development to production")
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        app.swipeUp()
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Promote development to production", "Running")).firstMatch.tap()
        XCTAssertTrue(find(app, "Promote staging to main").waitForExistence(timeout: 10))
        XCTAssertTrue(find(app, "Merged PR #210").exists)
        app.buttons["task-live"].tap()
        XCTAssertTrue(find(app, "railway.railway_status").waitForExistence(timeout: 5))
        capture(app, "Task with plan and live work")
    }

    func testOpsHubScreens() {
        let app = launch()
        app.tabBars.buttons["Ops"].tap()
        app.buttons["hub-pulse"].tap()
        XCTAssertTrue(find(app, "Lakeside Ask is degraded").waitForExistence(timeout: 10))
        capture(app, "Pulse")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["hub-desk"].tap()
        XCTAssertTrue(find(app, "Budget screen shows zero funding").waitForExistence(timeout: 10))
        capture(app, "Desk")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["hub-work"].tap()
        XCTAssertTrue(find(app, "Keir chat in Lakeside Ops").waitForExistence(timeout: 10))
        capture(app, "Work")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["hub-files"].tap()
        let report = find(app, "Turn time breakdown")
        XCTAssertTrue(report.waitForExistence(timeout: 10)); report.tap()
        XCTAssertTrue(find(app, "Settlement took 15.6s").waitForExistence(timeout: 10))
        capture(app, "File")
    }

    func testWatchesMemoryAndThreads() {
        let app = launch()
        openTool(app, "Watches")
        XCTAssertTrue(find(app, "PR 201 is merged").waitForExistence(timeout: 10))
        app.buttons["watch-add"].tap()
        let example = app.buttons["Turn time goes above 90 seconds"]
        XCTAssertTrue(example.waitForExistence(timeout: 5)); example.tap()
        app.buttons["watch-save"].tap()
        XCTAssertTrue(find(app, "Turn time goes above 90 seconds").waitForExistence(timeout: 10))
        capture(app, "Watches")
        app.buttons["Done"].firstMatch.tap()
        openTool(app, "Memory")
        XCTAssertTrue(find(app, "Never promote economy changes").waitForExistence(timeout: 10))
        capture(app, "Memory")
        app.buttons["Done"].firstMatch.tap()
        let threads = app.buttons["keir-threads"]
        XCTAssertTrue(threads.waitForExistence(timeout: 5))
        for _ in 0..<3 { if threads.isHittable { break }; sleep(1) }
        threads.tap()
        XCTAssertTrue(find(app, "Bond market").waitForExistence(timeout: 10))
        capture(app, "Threads")
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
