import Testing
import Foundation
import AppKit
@testable import DebridStreamer

@Suite("ImageLoader Tests")
struct ImageLoaderTests {

    @Test("image(for:) coalesces concurrent reads and caches the result")
    func coalescesAndCaches() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        let coverURL = URL(string: "https://assets.localhost/media/cover-1.png")!
        let png = makePNGData()
        let tracker = RequestTracker()
        tracker.configure(
            responses: [
                coverURL: .success(png)
            ]
        )

        MockURLProtocol.setHandler(tracker.handle(_:) , for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let loader = ImageLoader(session: session)
        async let first = loader.image(for: coverURL)
        async let second = loader.image(for: coverURL)
        let results = await [first, second]

        #expect(results.count == 2)
        #expect(results[0] != nil)
        #expect(results[1] != nil)
        #expect(tracker.calls(for: coverURL) == 1)

        let cached = await loader.image(for: coverURL)
        #expect(cached != nil)
        #expect(tracker.calls(for: coverURL) == 1)
    }

    @Test("prefetch warms cache for valid image URL")
    func prefetchWarmCache() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        let coverURL = URL(string: "https://assets.localhost/media/cover-2.png")!
        let png = makePNGData(color: .magenta)
        let tracker = RequestTracker()
        tracker.configure(
            responses: [
                coverURL: .success(png)
            ]
        )
        MockURLProtocol.setHandler(tracker.handle(_:) , for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let loader = ImageLoader(session: session)
        await loader.prefetch([coverURL])

        #expect(tracker.callCount == 0)
        try await Task.sleep(for: .milliseconds(120))

        let image = await loader.image(for: coverURL)
        #expect(image != nil)
        #expect(tracker.calls(for: coverURL) == 1)
    }

    @Test("prefetch with duplicate URLs only makes one request")
    func prefetchDeduplicatesDuplicateURLs() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        let coverURL = URL(string: "https://assets.localhost/media/cover-3.png")!
        let png = makePNGData(color: .orange)
        let tracker = RequestTracker()
        tracker.configure(
            responses: [
                coverURL: .success(png)
            ]
        )
        MockURLProtocol.setHandler(tracker.handle(_:) , for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let loader = ImageLoader(session: session)
        await loader.prefetch([coverURL, coverURL, coverURL])

        // Let the prefetch task settle.
        try await Task.sleep(for: .milliseconds(120))

        let image = await loader.image(for: coverURL)
        #expect(image != nil)
        #expect(tracker.calls(for: coverURL) == 1)
    }

    @Test("prefetch skips URLs already in cache")
    func prefetchSkipsCachedURLs() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        let coverURL = URL(string: "https://assets.localhost/media/cover-4.png")!
        let png = makePNGData(color: .cyan)
        let tracker = RequestTracker()
        tracker.configure(
            responses: [
                coverURL: .success(png)
            ]
        )
        MockURLProtocol.setHandler(tracker.handle(_:) , for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let loader = ImageLoader(session: session)

        let first = await loader.image(for: coverURL)
        #expect(first != nil)
        #expect(tracker.calls(for: coverURL) == 1)

        await loader.prefetch([coverURL])
        #expect(tracker.calls(for: coverURL) == 1)

        let second = await loader.image(for: coverURL)
        #expect(second != nil)
        #expect(tracker.calls(for: coverURL) == 1)
    }

    @Test("image(for:) returns nil when payload is not decodable")
    func returnsNilForInvalidImagePayload() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        let coverURL = URL(string: "https://assets.localhost/media/not-image.bin")!
        let tracker = RequestTracker()
        tracker.configure(
            responses: [
                coverURL: .success(Data([0x00, 0x01, 0x02]))
            ]
        )
        MockURLProtocol.setHandler(tracker.handle(_:) , for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let loader = ImageLoader(session: session)
        let image = await loader.image(for: coverURL)

        #expect(image == nil)
        #expect(tracker.calls(for: coverURL) == 1)
    }

    @Test("image(for:) returns nil for non-success status codes")
    func returnsNilForNonSuccessStatus() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        let coverURL = URL(string: "https://assets.localhost/media/http-404.png")!
        let tracker = RequestTracker()
        tracker.configure(
            responses: [
                coverURL: .statusError(statusCode: 404, data: makePNGData())
            ]
        )
        MockURLProtocol.setHandler(tracker.handle(_:) , for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let loader = ImageLoader(session: session)
        let image = await loader.image(for: coverURL)

        #expect(image == nil)
        #expect(tracker.calls(for: coverURL) == 1)
    }
}

private struct ImageLoaderResponse {
    let response: HTTPURLResponse
    let data: Data
}

private final class RequestTracker {
    enum Outcome {
        case success(Data)
        case statusError(statusCode: Int, data: Data)
        case failure(Error)
    }

    private let lock = NSLock()
    private var responses: [String: Outcome] = [:]
    private var calls: [String: Int] = [:]

    var callCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return calls.values.reduce(0, +)
    }

    func calls(for url: URL) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return calls[url.absoluteString] ?? 0
    }

    func configure(responses: [URL: Outcome]) {
        lock.lock()
        defer { lock.unlock() }
        self.responses = Dictionary(uniqueKeysWithValues: responses.map { ($0.key.absoluteString, $0.value) })
        calls.removeAll()
    }

    func handle(_ request: URLRequest) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url else {
            throw NSError(domain: "ImageLoaderTests", code: 1)
        }

        lock.lock()
        calls[url.absoluteString, default: 0] += 1
        let configured = responses[url.absoluteString]
        lock.unlock()

        guard let responseURL = request.url else {
            throw NSError(domain: "ImageLoaderTests", code: 2)
        }

        let statusCode: Int
        let payload: Data

        switch configured {
        case .success(let data):
            statusCode = 200
            payload = data
        case .statusError(let code, let data):
            statusCode = code
            payload = data
        case .failure(let error):
            throw error
        case nil:
            statusCode = 200
            payload = Data()
        }

        guard let httpResponse = HTTPURLResponse(
            url: responseURL,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        ) else {
            throw NSError(domain: "ImageLoaderTests", code: 2)
        }

        return (httpResponse, payload)
    }
}

private func makePNGData(color: NSColor = .systemBlue) -> Data {
    let image = NSImage(size: NSSize(width: 2, height: 2))
    image.lockFocus()
    color.setFill()
    NSBezierPath(rect: NSRect(origin: .zero, size: image.size)).fill()
    image.unlockFocus()

    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let pngData = bitmap.representation(using: .png, properties: [:]) else {
        return Data()
    }
    return pngData
}
