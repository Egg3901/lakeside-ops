import XCTest
@testable import LakesideOps

private class SpeechTransport: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard request.url?.path == "/api/keir/app/voice/speech" else { return }
        XCTAssertEqual(request.timeoutInterval, 20)
        // Deliberately leave the request pending until the voice deadline.
    }
    override func stopLoading() {}
}

private final class FailedSpeechTransport: SpeechTransport, @unchecked Sendable {
    override func startLoading() {
        XCTAssertEqual(request.timeoutInterval, 20)
        client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
    }
}

@MainActor final class VoicePlaybackTests: XCTestCase {
    private func session(failing: Bool = false) -> AppSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = failing ? [FailedSpeechTransport.self] : [SpeechTransport.self]
        return AppSession(.ops, configuration: config)
    }
    func testUnavailableOnlineSpeechFallsBackToDeviceVoice() async {
        let voice = KeirVoice(), usedDevice = expectation(description: "Device voice receives reply")
        voice.speakMicrosoft("Unavailable", session: session(failing: true), deadline: .seconds(5)) { text in
            XCTAssertEqual(text, "Unavailable"); usedDevice.fulfill()
        }
        await fulfillment(of: [usedDevice], timeout: 2)
        XCTAssertFalse(voice.preparingSpeech); XCTAssertNil(voice.error)
        voice.stop()
    }
    func testHungOnlineSpeechFallsBackAfterDeadline() async {
        let voice = KeirVoice(), usedDevice = expectation(description: "Hung speech recovers")
        voice.speakMicrosoft("A delayed reply", session: session(), deadline: .milliseconds(50)) { text in
            XCTAssertEqual(text, "A delayed reply"); usedDevice.fulfill()
        }
        XCTAssertTrue(voice.preparingSpeech)
        await fulfillment(of: [usedDevice], timeout: 2)
        XCTAssertFalse(voice.preparingSpeech); XCTAssertNil(voice.error)
        voice.stop()
    }
    func testEndingVoiceCancelsPendingDeviceFallback() async {
        let voice = KeirVoice(), usedDevice = expectation(description: "Stopped voice stays silent")
        usedDevice.isInverted = true
        voice.speakMicrosoft("A delayed reply", session: session(), deadline: .milliseconds(50)) { _ in usedDevice.fulfill() }
        voice.stop()
        await fulfillment(of: [usedDevice], timeout: 0.2)
        XCTAssertFalse(voice.preparingSpeech); XCTAssertFalse(voice.speaking)
    }
}
