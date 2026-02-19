import Foundation

final class MockURLProtocol: URLProtocol {
    typealias Handler = (URLRequest) throws -> (HTTPURLResponse, Data)

    nonisolated(unsafe) static var requestHandler: Handler?
    nonisolated(unsafe) private static var handlerBySessionID: [String: Handler] = [:]
    private static let handlerLock = NSLock()
    static let sessionHeader = "X-Mock-Session-ID"

    static func setHandler(_ handler: @escaping Handler, for sessionID: String) {
        handlerLock.lock()
        handlerBySessionID[sessionID] = handler
        handlerLock.unlock()
    }

    static func removeHandler(for sessionID: String) {
        handlerLock.lock()
        handlerBySessionID.removeValue(forKey: sessionID)
        handlerLock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        let scopedHandler: Handler? = {
            guard let sessionID = request.value(forHTTPHeaderField: Self.sessionHeader) else {
                return nil
            }
            Self.handlerLock.lock()
            defer { Self.handlerLock.unlock() }
            return Self.handlerBySessionID[sessionID]
        }()

        guard let handler = scopedHandler ?? Self.requestHandler else {
            client?.urlProtocol(self, didFailWithError: NSError(domain: "MockURLProtocol", code: 0))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

func makeMockSession(sessionID: String = UUID().uuidString) -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MockURLProtocol.self]
    config.httpAdditionalHeaders = [MockURLProtocol.sessionHeader: sessionID]
    return URLSession(configuration: config)
}
