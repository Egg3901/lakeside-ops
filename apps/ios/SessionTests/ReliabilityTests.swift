import XCTest
@testable import LakesideOps

private final class ReliabilityTransport: URLProtocol, @unchecked Sendable {
    final class State: @unchecked Sendable {
        let lock = NSLock()
        var offline = false
        var unauthorized = false
        var registrations = 0
        func reset() { lock.lock(); defer { lock.unlock() }; offline = false; unauthorized = false; registrations = 0 }
    }
    static let state = State()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.state.lock.lock()
        let offline = Self.state.offline, unauthorized = Self.state.unauthorized
        if request.url?.path == "/api/keir/app/devices" { Self.state.registrations += 1 }
        Self.state.lock.unlock()
        if offline { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)); return }
        let path = request.url?.path ?? ""
        let status = path == "/api/auth/native-session" ? 404 : path == "/temporary-auth-failure" || unauthorized ? 401 : 200
        let body = path == "/api/me" ? #"{"role":"admin","email":"fixture@example.test"}"# : #"{"ok":true}"#
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor final class ReliabilityTests: XCTestCase {
    private func session() -> AppSession {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ReliabilityTransport.self]
        return AppSession(.ops, configuration: config)
    }
    private func signIn(_ app: AppSession) async throws {
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.name: "ops_session", .value: String(repeating: "f", count: 64), .domain: "ops.lakesidegames.net", .path: "/", .secure: "TRUE", .expires: Date().addingTimeInterval(3600)]))
        try await app.accept(cookie)
    }
    func testNotificationTapFinishesOnMainThreadWhenCalledFromABackgroundQueue() async {
        let finished = expectation(description: "Notification completion")
        DispatchQueue.global().async {
            OpsNotificationDelivery.handle(route: "feed", thread: nil, decision: nil, action: "default", text: "") {
                XCTAssertTrue(Thread.isMainThread, "UIKit snapshot completion must run on main")
                finished.fulfill()
            }
        }
        await fulfillment(of: [finished], timeout: 5)
        XCTAssertEqual(OpsServices.shared.router.tab, .feed)
    }

    func testDownstream401DoesNotDiscardTheOwnersSession() async throws {
        ReliabilityTransport.state.reset()
        let app = session(); try await signIn(app)
        do { _ = try await app.get("/temporary-auth-failure"); XCTFail("Expected service failure") } catch {}
        XCTAssertTrue(app.signedIn)
        ReliabilityTransport.state.unauthorized = true
        await app.refreshProfile()
        XCTAssertFalse(app.signedIn, "Canonical revocation must still sign out")
        ReliabilityTransport.state.reset(); await app.signOut()
    }
    func testOfflineRestoreKeepsSavedSignIn() async throws {
        ReliabilityTransport.state.reset()
        let original = session(); try await signIn(original)
        ReliabilityTransport.state.offline = true
        let restored = session(); await restored.restore()
        XCTAssertTrue(restored.signedIn)
        XCTAssertNotNil(restored.error)
        ReliabilityTransport.state.reset(); await restored.signOut()
    }
    func testDeviceTokenReceivedBeforeSignInIsRetainedAndRegisteredAfterSignIn() async throws {
        ReliabilityTransport.state.reset()
        let app = session()
        let token = String(repeating: "b", count: 64)
        await OpsPushRegistration.send(token, session: app)
        XCTAssertEqual(UserDefaults.standard.string(forKey: "push.token"), token)
        XCTAssertEqual(ReliabilityTransport.state.registrations, 0)
        try await signIn(app)
        await OpsPushRegistration.send(token, session: app)
        XCTAssertEqual(ReliabilityTransport.state.registrations, 1)
        await app.signOut(); UserDefaults.standard.removeObject(forKey: "push.token")
    }
}
