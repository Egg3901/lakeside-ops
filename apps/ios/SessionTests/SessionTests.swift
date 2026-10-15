import XCTest
@testable import LakesideOps

@MainActor final class SessionTests: XCTestCase {
    private func session() -> AppSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FixtureProtocol.self]
        return AppSession(.ops, configuration: config)
    }
    private func askSession() -> AppSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FixtureProtocol.self]
        return AppSession(.ask, configuration: config)
    }
    func testOpsProductionCookieCompletesSignIn() async throws {
        // Same attributes as opsSessionCookie: the server omits Secure.
        let url = URL(string: "https://ops.lakesidegames.net/")!
        let cookie = try XCTUnwrap(HTTPCookie.cookies(withResponseHeaderFields: [
            "Set-Cookie": "ops_session=fixture-login; Path=/; HttpOnly; SameSite=Lax; Domain=.lakesidegames.net; Max-Age=3600"
        ], for: url).first)
        XCTAssertFalse(cookie.isSecure)
        let app = session()
        try await app.accept(cookie)
        XCTAssertTrue(app.signedIn)
        XCTAssertEqual(app.profile["role"].string, "admin")
        await app.signOut()
    }
    func testPublicSuffixCookieCannotSignIn() async throws {
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.name: "ops_session", .value: "fixture-login", .domain: ".net", .path: "/", .secure: "TRUE"]))
        let app = session()
        do { try await app.accept(cookie); XCTFail("Public suffix accepted") } catch {}
        XCTAssertFalse(app.signedIn)
    }
    func testAskStillRequiresItsSecureCookie() async throws {
        let app = askSession()
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.name: "__Host-ask_session", .value: "fixture-login", .domain: "ask.lakesidegames.net", .path: "/"]))
        do { try await app.accept(cookie); XCTFail("Ask accepted an insecure cookie") } catch {}
        XCTAssertFalse(app.signedIn)
    }
    func testAskProductionCookieCompletesSignIn() async throws {
        let url = URL(string: "https://ask.lakesidegames.net/")!
        let cookie = try XCTUnwrap(HTTPCookie.cookies(withResponseHeaderFields: [
            "Set-Cookie": "__Host-ask_session=fixture-login; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600"
        ], for: url).first)
        let app = askSession()
        try await app.accept(cookie)
        XCTAssertTrue(app.signedIn)
        XCTAssertEqual(app.profile["identity"]["username"].string, "Test operator")
        await app.signOut()
    }
    func testAskUnifiedAuthCookieCompletesSignIn() async throws {
        let url = URL(string: "https://ask.lakesidegames.net/")!
        let cookie = try XCTUnwrap(HTTPCookie.cookies(withResponseHeaderFields: [
            "Set-Cookie": "__Host-lakeside_session=fixture-login; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600"
        ], for: url).first)
        let app = askSession()
        try await app.accept(cookie)
        XCTAssertTrue(app.signedIn)
        XCTAssertEqual(app.profile["identity"]["username"].string, "Test operator")
        await app.signOut()
    }
    func testAskContextUsesTheAuthenticatedSession() async throws {
        let app = askSession()
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.name: "__Host-ask_session", .value: "fixture-login", .domain: "ask.lakesidegames.net", .path: "/", .secure: "TRUE"]))
        try await app.accept(cookie)
        let context = try await app.post("/api/ask/context", ["question": .string("How does inflation work?"), "game": .string("ahd")])
        XCTAssertEqual(context["game"]["id"].string, "ahd")
        XCTAssertTrue(context["context"].string.contains("price index"))
        await app.signOut()
    }
    func testAskRejectsLegacyCookieName() async throws {
        let app = askSession()
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.name: "ask_session", .value: "fixture-login", .domain: "ask.lakesidegames.net", .path: "/", .secure: "TRUE"]))
        do { try await app.accept(cookie); XCTFail("Ask accepted the legacy cookie name") } catch {}
        XCTAssertFalse(app.signedIn)
    }
    func testApplePromptUsesRetrievedGameEvidence() {
        let prompt = AppleFoundationModelPrompt.make(
            question: "How does inflation work?",
            history: [],
            gameName: "A House Divided",
            gameSubject: "a political strategy game",
            gameEvidence: "SOURCE CODE: inflation is calculated from the price index.",
            length: "standard",
            style: "standard",
            mode: "auto"
        )
        XCTAssertTrue(prompt.contains("inflation is calculated from the price index"))
        XCTAssertTrue(prompt.contains("Use the evidence for game mechanics"))
        XCTAssertFalse(prompt.contains("You do not have access to current game state, server tools, citations, or live data."))
    }
    func testAppleFoundationModelToolProtocolIsRejected() {
        XCTAssertTrue(ToolProtocolSanitizer.containsProtocol(#"{"recipient_name":"gamestate","tool_input":{"country":"US"}}"#))
        XCTAssertTrue(ToolProtocolSanitizer.containsProtocol("<tool_call><function=country_fiscal>"))
        XCTAssertFalse(ToolProtocolSanitizer.containsProtocol("US inflation is currently elevated."))
    }
    func testUnrelatedCookieCannotSignIn() async throws {
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.name: "ops_session", .value: "fixture", .domain: "attacker.example", .path: "/", .secure: "TRUE"]))
        let app = session()
        do { try await app.accept(cookie); XCTFail("Unrelated domain accepted") } catch {}
        XCTAssertFalse(app.signedIn)
    }
}
