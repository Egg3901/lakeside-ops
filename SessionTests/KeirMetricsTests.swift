import XCTest
import LakesideCore
@testable import LakesideOps

private final class MetricsTransport: URLProtocol, @unchecked Sendable {
    final class State: @unchecked Sendable {
        let lock = NSLock()
        private var status = 200
        private var body = #"{"at":1792020000000,"kpis":{"activations24h":46}}"#
        func set(_ status: Int, _ body: String) { lock.lock(); defer { lock.unlock() }; self.status = status; self.body = body }
        func response() -> (Int, String) { lock.lock(); defer { lock.unlock() }; return (status, body) }
    }
    static let state = State()
    override class func canInit(with request: URLRequest) -> Bool { request.url?.path == "/api/keir/hub" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (status, body) = Self.state.response()
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor final class KeirMetricsTests: XCTestCase {
    func testFailedOrIncompleteRefreshRetainsLastSnapshotAndRecoveryClearsError() async {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [MetricsTransport.self]
        let session = AppSession(.ops, configuration: config), store = KeirMetricsStore()
        MetricsTransport.state.set(200, #"{"at":1792020000000,"kpis":{"activations24h":46}}"#)
        await store.refresh(session)
        XCTAssertEqual(store.snapshot["kpis"]["activations24h"].number, 46)
        MetricsTransport.state.set(503, #"{"error":"Temporarily unavailable"}"#)
        await store.refresh(session)
        XCTAssertEqual(store.snapshot["kpis"]["activations24h"].number, 46)
        XCTAssertNotNil(store.error)
        MetricsTransport.state.set(200, #"{"kpis":{}}"#)
        await store.refresh(session)
        XCTAssertEqual(store.snapshot["kpis"]["activations24h"].number, 46)
        XCTAssertNotNil(store.error)
        MetricsTransport.state.set(200, #"{"at":1792020000001,"kpis":{"activations24h":47}}"#)
        await store.refresh(session)
        XCTAssertEqual(store.snapshot["kpis"]["activations24h"].number, 47)
        XCTAssertNil(store.error)
    }

    func testUnknownAndZeroMetricsRemainDifferent() {
        XCTAssertEqual(KeirMetricFormat.count(.null), "Not recorded")
        XCTAssertEqual(KeirMetricFormat.count(.number(0)), "0")
        XCTAssertEqual(KeirMetricFormat.percent(.null), "No sample")
        XCTAssertEqual(KeirMetricFormat.percent(.number(0)), "0.0%")
        XCTAssertEqual(KeirMetricFormat.duration(.null), "Not recorded")
        XCTAssertEqual(KeirMetricFormat.duration(.number(-1)), "Not recorded")
        XCTAssertEqual(KeirMetricFormat.duration(.number(12000)), "12s")
    }
}
