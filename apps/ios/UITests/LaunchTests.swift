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
            if tools.waitForExistence(timeout: 5) && tools.isHittable && tools.isEnabled { tools.tap() }
            if app.buttons[name].waitForExistence(timeout: 3) {
                app.buttons[name].tap()
                if app.navigationBars[name].waitForExistence(timeout: 5) { return }
            }
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
        // The answer scrolls to the latest message. Scroll back to the approval
        // explicitly rather than relying on XCTest's lazy-stack auto-scroll.
        let keyboardGone = NSPredicate(format: "exists == false")
        expectation(for: keyboardGone, evaluatedWith: app.keyboards.firstMatch)
        waitForExpectations(timeout: 5)
        for _ in 0..<8 {
            if app.buttons["decision-approve"].isHittable { break }
            app.scrollViews.firstMatch.swipeDown()
        }
        guard app.buttons["decision-approve"].isHittable else { XCTFail("Approval is not visible after scrolling to older messages"); return }
        app.buttons["decision-approve"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["decision-approve"])
        waitForExpectations(timeout: 5)
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
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Promote development to production", "Running")).firstMatch.tap()
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

    func testNativeStopStartAndYoloControls() {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures"]; app.launch()
        let kill = app.buttons["keir-kill-switch"]
        XCTAssertTrue(kill.waitForExistence(timeout: 15)); kill.tap()
        XCTAssertTrue(app.staticTexts["Stopped"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(kill.label.contains("Start")); capture(app, "Keir stopped")
        kill.tap()
        XCTAssertTrue(app.staticTexts["Ready"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["keir-tools"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Controls, providers")).firstMatch.tap()
        let yolo = app.switches["keir-yolo"]
        XCTAssertTrue(yolo.waitForExistence(timeout: 8)); yolo.tap()
        let conversation = app.buttons["keir-route-conversation"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 5)); conversation.tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Fixture model")).firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Keir controls"].exists); capture(app, "Keir controls")
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(app.buttons["keir-yolo-banner"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["keir-model"].label.contains("Fixture model"))
        capture(app, "Keir native presence")
    }

    func testChoicesModelSwitchAndConcurrentWork() {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures", "--uitest-rich-controls", "--uitest-legacy-model-picker"]; app.launch()
        XCTAssertTrue(app.buttons["keir-model"].waitForExistence(timeout: 15))
        app.buttons["keir-model"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Fixture model")).firstMatch.tap()
        XCTAssertTrue(find(app, "Fixture model").waitForExistence(timeout: 5))
        XCTAssertTrue(find(app, "Investigate payroll").waitForExistence(timeout: 5))
        XCTAssertTrue(find(app, "Check technology upgrades").exists)
        let choice = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Use filled jobs")).firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 5)); choice.tap()
        app.buttons["keir-answer-choices"].tap()
        XCTAssertTrue(find(app, "Answered").waitForExistence(timeout: 5))
        capture(app, "Structured choice and parallel work")
        let composer = app.textFields["keir-composer"].exists ? app.textFields["keir-composer"] : app.textViews["keir-composer"]
        composer.tap(); app.typeText("/chart")
        XCTAssertTrue(app.scrollViews["keir-commands"].waitForExistence(timeout: 5))
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Graph data with sources")).firstMatch.tap()
        XCTAssertTrue((composer.value as? String ?? "").contains("Show a chart"))
        capture(app, "Slash commands")
    }

    func testTicketExplainsBlockersAndCompletedWork() {
        let app = launch()
        app.tabBars.buttons["Ops"].tap(); app.buttons["hub-desk"].tap()
        let ticket = find(app, "Budget screen shows zero funding")
        XCTAssertTrue(ticket.waitForExistence(timeout: 10)); ticket.tap()
        XCTAssertTrue(find(app, "Choose payroll behavior").waitForExistence(timeout: 10))
        XCTAssertTrue(find(app, "Waiting for the owner decision").exists)
        XCTAssertTrue(find(app, "Filed issue #99").exists)
        capture(app, "Ticket blockers and Keir work")
    }

    func testComputerInputUncertaintyInspectionAndClose() {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures", "--uitest-computer"]; app.launch()
        XCTAssertTrue(app.buttons["keir-tools"].waitForExistence(timeout: 15))
        openTool(app, "Computer")
        let browser = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Fixture browser")).firstMatch
        XCTAssertTrue(browser.waitForExistence(timeout: 5)); browser.tap()
        let enter = app.buttons["Enter"]
        XCTAssertTrue(enter.waitForExistence(timeout: 5)); if !enter.isHittable { app.swipeUp() }; enter.tap()
        let refresh = app.buttons["Refresh browser screen"]
        XCTAssertTrue(refresh.waitForExistence(timeout: 8)); if !refresh.isHittable { app.swipeUp() }; refresh.tap()
        let inspected = app.buttons["I inspected the result. Allow new input."]
        XCTAssertTrue(inspected.waitForExistence(timeout: 5)); inspected.tap()
        let close = app.buttons["Close browser and delete its profile"]
        XCTAssertTrue(close.waitForExistence(timeout: 5)); if !close.isHittable { app.swipeUp() }; close.tap()
        XCTAssertTrue(find(app, "Saved result").waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Enter"].exists)
    }

    func testCancelledComputerInspectionAndExplicitDiscard() {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures", "--uitest-computer", "--uitest-computer-cancelled"]; app.launch()
        XCTAssertTrue(app.buttons["keir-tools"].waitForExistence(timeout: 15))
        openTool(app, "Computer")
        let browser = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Fixture browser")).firstMatch
        XCTAssertTrue(browser.waitForExistence(timeout: 5)); browser.tap()
        XCTAssertTrue(find(app, "Needs inspection").waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Enter"].exists)
        let discard = app.buttons["Discard retained browser"]
        XCTAssertTrue(discard.waitForExistence(timeout: 5)); if !discard.isHittable { app.swipeUp() }; discard.tap()
        let confirm = app.buttons["Discard browser and profile"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5)); confirm.tap()
        XCTAssertTrue(find(app, "Saved result").waitForExistence(timeout: 5))
    }

    func testKeirUnavailableKeepsDraftAndRetriesConnection() {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures", "--uitest-keir-offline"]; app.launch()
        XCTAssertTrue(app.staticTexts["keir-connection-state"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["keir-retry-connection"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["What needs my attention right now?"].exists)
        let composer = app.textFields["keir-composer"].exists ? app.textFields["keir-composer"] : app.textViews["keir-composer"]
        composer.tap(); app.typeText("Keep this draft")
        app.buttons["keir-send"].tap()
        XCTAssertTrue((composer.value as? String ?? "").contains("Keep this draft"))
        app.buttons["keir-retry-connection"].tap()
        XCTAssertTrue((composer.value as? String ?? "").contains("Keep this draft"))
        XCTAssertTrue(app.buttons["keir-retry-connection"].waitForExistence(timeout: 5))
    }

    func testKeirDashboardMetricsAndMonitoring() {
        let app = launch()
        app.tabBars.buttons["Ops"].tap(); app.buttons["hub-dashboard"].tap()
        XCTAssertTrue(app.navigationBars["Keir dashboard"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Activations, 46"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Median activation, 12s"].exists)
        capture(app, "Keir dashboard execution metrics")
        // LabeledContent exposes one accessible label/value pair. Match both
        // so a visible title with an incorrect or missing value cannot pass.
        for title in ["Distinct root tickets, 4", "Median time to closure, 1.0h", "Requests classified, 31", "Open findings, 3"] {
            let row = app.staticTexts[title]
            for _ in 0..<12 { if row.exists && row.isHittable { break }; app.swipeUp() }
            guard row.exists && row.isHittable else { capture(app, "Missing dashboard metric"); XCTFail("Dashboard must expose \(title)"); return }
            capture(app, title)
        }
        capture(app, "Keir dashboard monitoring")
    }

    func testKeirDashboardDoesNotInventMissingMetrics() {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures", "--uitest-metrics-partial"]; app.launch()
        XCTAssertTrue(app.tabBars.buttons["Ops"].waitForExistence(timeout: 15))
        app.tabBars.buttons["Ops"].tap(); app.buttons["hub-dashboard"].tap()
        XCTAssertTrue(app.staticTexts["Median activation, Not recorded"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Successful activations, No sample"].waitForExistence(timeout: 5))
        for _ in 0..<10 {
            if app.staticTexts["No shadow quality sample yet."].exists { break }
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts["No shadow quality sample yet."].exists)
        capture(app, "Keir dashboard missing samples")
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
