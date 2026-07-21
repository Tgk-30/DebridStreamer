import Testing
import Foundation
import AVFoundation
@testable import DebridStreamer

@Suite("AVPlayerEngine Tests")
@MainActor
struct AVPlayerEngineTests {

    @Test("canHandle accepts supported and unsupported extensions")
    func canHandleExtensions() {
        let engine = AVPlayerEngine(session: .shared, validateReachability: false)

        let mp4Stream = StreamInfo(
            streamURL: "https://cdn.example.com/video.mp4",
            quality: .hd1080p,
            codec: .h264,
            audio: .aac,
            source: .webDL,
            sizeBytes: 1_000,
            fileName: "video.mp4",
            debridService: "Real-Debrid"
        )

        let plainStream = StreamInfo(
            streamURL: "https://cdn.example.com/live",
            quality: .unknown,
            codec: .unknown,
            audio: .unknown,
            source: .unknown,
            sizeBytes: 1_000,
            fileName: "live",
            debridService: "Real-Debrid"
        )

        let webpStream = StreamInfo(
            streamURL: "https://cdn.example.com/picture.webp",
            quality: .unknown,
            codec: .unknown,
            audio: .unknown,
            source: .unknown,
            sizeBytes: 1_000,
            fileName: "picture.webp",
            debridService: "Real-Debrid"
        )

        #expect(engine.canHandle(mp4Stream) == true)
        #expect(engine.canHandle(plainStream) == true)
        #expect(engine.canHandle(webpStream) == false)
    }

    @Test("prepare rejects missing URLs")
    func prepareRejectsEmptyURL() async {
        let engine = AVPlayerEngine(session: .shared, validateReachability: false)
        let stream = StreamInfo(
            streamURL: "",
            quality: .unknown,
            codec: .unknown,
            audio: .unknown,
            source: .unknown,
            sizeBytes: 1_000,
            fileName: "x",
            debridService: "Real-Debrid"
        )

        do {
            _ = try await engine.prepare(stream: stream)
            Issue.record("Expected invalidStreamURL error")
        } catch let error as PlayerEngineError {
            #expect(error == .invalidStreamURL(""))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("prepare fails when HEAD check reports non-2xx")
    func prepareFailingHeadStatus() async {
        let stream = StreamInfo(
            streamURL: "https://example.com/video.mkv",
            quality: .hd1080p,
            codec: .h264,
            audio: .aac,
            source: .webDL,
            sizeBytes: 1_000,
            fileName: "video.mkv",
            debridService: "Real-Debrid"
        )

        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        MockURLProtocol.setHandler({ request in
            return try ResponseBuilder.make(for: request, statusCode: 503)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let engine = AVPlayerEngine(session: session, validateReachability: true)

        do {
            _ = try await engine.prepare(stream: stream)
            Issue.record("Expected streamHTTPStatus error")
        } catch let error as PlayerEngineError {
            #expect(error == .streamHTTPStatus(503))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("prepare keeps playing metadata failures best effort when reachability cannot be checked")
    func prepareIgnoreNetworkErrorsWhenReachabilityFails() async throws {
        let stream = StreamInfo(
            streamURL: "https://example.com/video.webm",
            quality: .hd1080p,
            codec: .unknown,
            audio: .unknown,
            source: .webDL,
            sizeBytes: 1_000,
            fileName: "video.webm",
            debridService: "Real-Debrid"
        )

        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        MockURLProtocol.setHandler({ _ in throw URLError(.cannotConnectToHost) }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let engine = AVPlayerEngine(session: session, validateReachability: true)
        let prepared = try await engine.prepare(stream: stream)

        #expect(prepared.kind == PlayerEngineKind.avPlayer)
        #expect(prepared.streamURL == URL(string: "https://example.com/video.webm"))
        #expect(prepared.avPlayer != nil)
        #expect(prepared.vlcSession == nil)
    }

    @Test("canHandle rejects unknown extension")
    func canHandleUnknownExtensionIsFalse() {
        let engine = AVPlayerEngine(session: .shared, validateReachability: false)
        let stream = StreamInfo(
            streamURL: "https://cdn.example.com/file.gif",
            quality: .unknown,
            codec: .unknown,
            audio: .unknown,
            source: .unknown,
            sizeBytes: 10,
            fileName: "file.gif",
            debridService: "Real-Debrid"
        )
        #expect(engine.canHandle(stream) == false)
    }

    @Test("readiness monitor throws for timeout value")
    func readinessMonitorRejectsNonPositiveTimeout() async {
        let monitor = AVPlayerReadinessMonitor()
        do {
            try await monitor.waitUntilReady(player: AVPlayer(), timeout: 0, onStateChange: { _, _ in })
            Issue.record("Expected unsupported timeout error")
        } catch let error as PlayerEngineError {
            #expect(error == .unsupported("AVPlayer readiness timeout must be greater than zero."))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("readiness monitor throws when there is no media item")
    func readinessMonitorRejectsMissingItem() async {
        let monitor = AVPlayerReadinessMonitor(pollInterval: .milliseconds(10))
        do {
            try await monitor.waitUntilReady(player: AVPlayer(), timeout: 0.1, onStateChange: { _, _ in })
            Issue.record("Expected unsupported player state error")
        } catch let error as PlayerEngineError {
            #expect(error == .unsupported("AVPlayer did not provide a media item."))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }
}

private enum ResponseBuilder {
    static func make(for request: URLRequest, statusCode: Int) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url else {
            throw NSError(domain: "AVPlayerEngineTests", code: 1)
        }
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        ) else {
            throw NSError(domain: "AVPlayerEngineTests", code: 2)
        }
        return (response, Data("{}".utf8))
    }
}
