import XCTest

final class LaunchTests: XCTestCase {
    func testNativeAuthenticatedScreens() {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures"]; app.launch()
        if app.tabBars.buttons["Keir"].waitForExistence(timeout: 5) {
            XCTAssertTrue(app.staticTexts["How did the last turn go?"].waitForExistence(timeout: 10))
            XCTAssertTrue(app.buttons["decision-approve"].waitForExistence(timeout: 10))
            capture(app, "Ops Keir thread with a decision")
            let composer = app.textFields["keir-composer"].exists ? app.textFields["keir-composer"] : app.textViews["keir-composer"]
            XCTAssertTrue(composer.waitForExistence(timeout: 5)); composer.tap(); composer.typeText("Which PRs are waiting on me?")
            app.buttons["keir-send"].tap()
            XCTAssertTrue(app.staticTexts["Two PRs are waiting on you: #201 and #202."].waitForExistence(timeout: 15))
            capture(app, "Ops Keir reply")
            app.buttons["decision-approve"].tap()
            XCTAssertFalse(app.buttons["decision-approve"].waitForExistence(timeout: 3))
            app.tabBars.buttons["Pulse"].tap()
            XCTAssertTrue(app.staticTexts["Lakeside Ask is degraded"].waitForExistence(timeout: 10))
            capture(app, "Ops pulse")
            app.swipeUp(); capture(app, "Ops pulse services and activity")
            app.tabBars.buttons["Desk"].tap()
            XCTAssertTrue(app.staticTexts["Budget screen shows zero funding"].waitForExistence(timeout: 10))
            capture(app, "Ops desk")
            app.staticTexts["Budget screen shows zero funding"].tap()
            XCTAssertTrue(app.staticTexts["Funding display fix"].waitForExistence(timeout: 10))
            capture(app, "Ops ticket detail")
            app.tabBars.buttons["Work"].tap()
            XCTAssertTrue(app.staticTexts["Keir chat in Lakeside Ops"].waitForExistence(timeout: 10))
            capture(app, "Ops work")
        } else {
            let conversation = app.staticTexts["How does inflation work?"]
            XCTAssertTrue(conversation.waitForExistence(timeout: 10)); conversation.tap()
            XCTAssertTrue(app.staticTexts["Prices respond to supply and demand."].waitForExistence(timeout: 10))
            capture(app, "Native Ask conversation")
            let composer = app.textFields["ask-composer"].exists ? app.textFields["ask-composer"] : app.textViews["ask-composer"]
            XCTAssertTrue(composer.waitForExistence(timeout: 5)); composer.tap(); composer.typeText("What changes prices?")
            app.buttons["Send question"].tap()
            allowOutsideAI(app)
            XCTAssertTrue(app.staticTexts["Verified final answer from the server."].waitForExistence(timeout: 10))
            XCTAssertFalse(app.staticTexts["A partial draft"].exists)
            capture(app, "Completed streamed answer")
        }
        XCTAssertEqual(app.webViews.count, 0)
    }
    func testAskOptionsUsageAndStarters() throws {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures"]; app.launch()
        if app.tabBars.buttons["Keir"].waitForExistence(timeout: 3) { throw XCTSkip("Ask features") }
        XCTAssertTrue(app.buttons["Daily allowance"].waitForExistence(timeout: 10))
        capture(app, "Ask 1.1 home")
        app.buttons["Daily allowance"].tap()
        XCTAssertTrue(app.staticTexts["Question credits"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["153.5 left"].exists)
        capture(app, "Ask allowance bars")
        app.buttons["Done"].tap()
        let explore = app.buttons["Explore questions"]
        reveal(explore, in: app)
        explore.tap()
        XCTAssertTrue(app.navigationBars["Explore questions"].waitForExistence(timeout: 5))
        capture(app, "Ask starter browser")
        app.buttons["Done"].tap()
        let conversation = app.staticTexts["How does inflation work?"]
        reveal(conversation, in: app, upward: false)
        conversation.tap()
        app.buttons["Answer options"].tap()
        XCTAssertTrue(app.staticTexts["Charts, diagrams, and maps"].waitForExistence(timeout: 5))
        capture(app, "Ask response options")
        app.buttons["Done"].tap()
        let mode = app.buttons["Answer mode"]
        XCTAssertTrue(mode.waitForExistence(timeout: 5)); mode.tap()
        XCTAssertTrue(app.buttons["Verify"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Autopsy"].exists)
        XCTAssertTrue(app.buttons["Scenario"].exists)
        XCTAssertTrue(app.buttons["Report"].exists)
        capture(app, "Ask answer modes")
        app.buttons["Report"].tap()
        XCTAssertEqual(mode.value as? String, "Report")
        app.buttons["Share conversation"].tap()
        XCTAssertTrue(app.buttons["Export as Markdown file"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Create public link"].waitForExistence(timeout: 5))
        app.buttons["Create public link"].tap()
        XCTAssertTrue(app.staticTexts["Your link is ready."].waitForExistence(timeout: 5))
        XCTAssertEqual(app.webViews.count, 0)
    }
    func testNativeAskChartAndMap() throws {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures", "--uitest-visuals"]; app.launch()
        if app.tabBars.buttons["Keir"].waitForExistence(timeout: 3) { throw XCTSkip("Ask visualizations") }
        let conversation = app.staticTexts["How does inflation work?"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 10)); conversation.tap()
        XCTAssertTrue(app.staticTexts["GDP growth"].waitForExistence(timeout: 10))
        capture(app, "Native Ask chart")
        app.swipeUp()
        let expand = app.buttons["Expand game map"]
        XCTAssertTrue(expand.waitForExistence(timeout: 10)); expand.tap()
        XCTAssertTrue(app.navigationBars["Game map"].waitForExistence(timeout: 5))
        capture(app, "Native Ask map")
        XCTAssertEqual(app.webViews.count, 0)
    }
    private func waitForEnabled(_ element: XCUIElement) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed)
    }
    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication, upward: Bool = true) {
        // UIKit can report an invalid activation point for offscreen SwiftUI rows.
        // Scroll from geometry first, then let tap resolve the visible element.
        for _ in 0..<8 {
            if element.exists {
                let frame = element.frame
                let top = app.frame.minY + 130
                let bottom = app.keyboards.firstMatch.exists ? app.keyboards.firstMatch.frame.minY - 12 : app.frame.maxY - 125
                if frame.width > 0 && frame.height > 0 && frame.minY >= top && frame.maxY <= bottom { return }
                if frame.height > 0 && frame.midY < top { app.swipeDown(); continue }
            }
            if upward { app.swipeUp() } else { app.swipeDown() }
        }
        XCTAssertTrue(element.exists)
    }
    private func openAskConversation(_ app: XCUIApplication) -> Bool {
        if app.tabBars.buttons["Keir"].waitForExistence(timeout: 3) { return false }
        let conversation = app.staticTexts["How does inflation work?"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 10)); conversation.tap()
        XCTAssertTrue(app.staticTexts["Prices respond to supply and demand."].waitForExistence(timeout: 10))
        return true
    }
    private func ask(_ text: String, in app: XCUIApplication) {
        let composer = app.textFields["ask-composer"].exists ? app.textFields["ask-composer"] : app.textViews["ask-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5)); composer.tap(); composer.typeText(text)
        app.buttons["Send question"].tap()
    }
    private func allowOutsideAI(_ app: XCUIApplication) {
        let allow = app.buttons["ask-consent-allow"]
        if allow.waitForExistence(timeout: 5) { allow.tap() }
    }
    private func text(containing value: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
    }
    func testAskConsentGateHoldsQuestionsUntilAllowed() throws {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures"]; app.launch()
        guard openAskConversation(app) else { throw XCTSkip("Ask consent") }
        ask("What changes prices?", in: app)
        let allow = app.buttons["ask-consent-allow"]
        XCTAssertTrue(allow.waitForExistence(timeout: 5), "A server question must wait for permission")
        XCTAssertTrue(text(containing: "DeepSeek", in: app).exists, "Every outside service from /api/me must be listed")
        capture(app, "Ask outside AI consent")
        app.buttons["ask-consent-decline"].tap()
        XCTAssertFalse(app.staticTexts["Verified final answer from the server."].waitForExistence(timeout: 2), "Declining must not send the question")
        app.buttons["Send question"].tap()
        XCTAssertTrue(allow.waitForExistence(timeout: 5)); allow.tap()
        XCTAssertTrue(app.staticTexts["Verified final answer from the server."].waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Verified source", in: app).exists)
        capture(app, "Ask answer with sources")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10)); settings.tap()
        let status = app.staticTexts["ask-consent-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        XCTAssertEqual(status.label, "Allowed")
        capture(app, "Ask settings")
        app.buttons["ask-settings-ai-providers"].tap()
        let withdraw = app.buttons["ask-consent-withdraw"]
        XCTAssertTrue(withdraw.waitForExistence(timeout: 5)); withdraw.tap()
        app.buttons["Close"].tap()
        let withdrawn = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Not allowed"), object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [withdrawn], timeout: 5), .completed)
    }
    func testAskWatchesListAndDelete() throws {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures"]; app.launch()
        if app.tabBars.buttons["Keir"].waitForExistence(timeout: 3) { throw XCTSkip("Ask watches") }
        let watches = app.buttons["ask-watches"]
        XCTAssertTrue(watches.waitForExistence(timeout: 10))
        capture(app, "Ask home")
        reveal(watches, in: app)
        watches.tap()
        let watch = app.staticTexts["USD/GBP crosses above 1.30"]
        XCTAssertTrue(watch.waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Watch USD/GBP and tell me", in: app).exists)
        capture(app, "Ask watches")
        app.buttons["ask-watch-delete-7"].tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: watch)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed)
        XCTAssertTrue(app.staticTexts["new war activity involving FR"].exists)
    }
    func testAskStopsAStreamingAnswer() throws {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures", "--uitest-slow-stream"]; app.launch()
        guard openAskConversation(app) else { throw XCTSkip("Ask stop") }
        ask("What changes prices?", in: app)
        allowOutsideAI(app)
        let stop = app.buttons["Stop answer"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["A partial draft"].waitForExistence(timeout: 10))
        capture(app, "Ask streaming answer")
        stop.tap()
        XCTAssertTrue(text(containing: "This answer was not saved and used no credits", in: app).waitForExistence(timeout: 10),
                      "The server must confirm the stop before the app says no credits were used")
        XCTAssertTrue(app.buttons["Send question"].waitForExistence(timeout: 5))
        capture(app, "Ask stopped answer")
    }
    func testAskShowsQuotaErrorTruthfully() throws {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures", "--uitest-quota"]; app.launch()
        guard openAskConversation(app) else { throw XCTSkip("Ask errors") }
        ask("What changes prices?", in: app)
        allowOutsideAI(app)
        XCTAssertTrue(app.staticTexts["Daily limit reached"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["You've used all 200 questions for today."].exists)
        XCTAssertFalse(text(containing: "sign in again", in: app).exists, "A quota error is not a sign-in problem")
        capture(app, "Ask quota error")
    }
    /// Scrolls until a list row is on screen. Lists create rows lazily.
    private func reveal(_ element: XCUIElement, in app: XCUIApplication, upward: Bool = true) {
        for _ in 0..<6 {
            if element.exists && element.isHittable { return }
            if upward { app.swipeUp() } else { app.swipeDown() }
        }
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    func testAttachmentMenu() throws {
        let app = XCUIApplication(); app.launchArguments = ["--uitest-fixtures"]; app.launch()
        if app.tabBars.buttons["Keir"].waitForExistence(timeout: 3) { throw XCTSkip("Ops sends text to Keir") }
        let conversation = app.staticTexts["How does inflation work?"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 10)); conversation.tap()
        let add = app.buttons["add-attachment"]
        XCTAssertTrue(add.waitForExistence(timeout: 10)); add.tap()
        XCTAssertTrue(app.buttons["Photo library"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Choose file"].exists)
        capture(app, "Native attachment picker")
    }
    func testNativeSignInAndCancellation() {
        let app = XCUIApplication(); app.launch()
        let signIn = app.buttons["Sign in to Lakeside"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 15))
        XCTAssertEqual(app.webViews.count, 0)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.lifetime = .keepAlways; add(screenshot)
        signIn.tap()
        let cancel = app.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 10))
        cancel.tap()
        XCTAssertTrue(signIn.waitForExistence(timeout: 5))
        XCTAssertEqual(app.webViews.count, 0)
    }
}
