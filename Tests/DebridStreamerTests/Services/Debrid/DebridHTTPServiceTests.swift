import Testing
import Foundation
@testable import DebridStreamer

@Suite("Debrid HTTP Request Tests")
struct DebridHTTPServiceTests {
    @Test("Services avoid credential query leakage and send expected payloads")
    func requestShapes() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var capturedRequests: [String: URLRequest] = [:]

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            capturedRequests[path] = request

            switch path {
            case "/v4/user":
                let body = """
                {"data":{"user":{"username":"ad-user","email":"ad@example.com","isPremium":true,"premiumUntil":1700000000}}}
                """
                return try makeResponse(for: request, statusCode: 200, body: body)
            case "/api/account/info":
                let body = #"{"customer_id":"pm-user","premium_until":1700000000}"#
                return try makeResponse(for: request, statusCode: 200, body: body)
            case "/api/transfer/directdl":
                let body = #"{"content":[{"link":"https://stream.example/file.mkv","path":"file.mkv","size":1234}]}"#
                return try makeResponse(for: request, statusCode: 200, body: body)
            case "/v1/api/torrents/mylist":
                let body = #"{"data":{"id":42,"download_state":"cached","files":[{"id":0,"name":"movie.mp4","size":1234}]}}"#
                return try makeResponse(for: request, statusCode: 200, body: body)
            case "/v1/api/torrents/requestdl":
                let body = #"{"data":"https://torbox.example/stream.mp4"}"#
                return try makeResponse(for: request, statusCode: 200, body: body)
            default:
                return try makeResponse(for: request, statusCode: 404, body: "{}")
            }
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let allDebrid = AllDebridService(apiToken: "all-token", session: session)
        _ = try await allDebrid.getAccountInfo()

        let premiumize = PremiumizeService(apiToken: "pm-token", session: session)
        _ = try await premiumize.getAccountInfo()
        _ = try await premiumize.getStreamURL(torrentId: "transfer123")

        let torBox = TorBoxService(apiToken: "tb-token", session: session)
        _ = try await torBox.getStreamURL(torrentId: "42")

        let allDebridRequest = try #require(capturedRequests["/v4/user"])
        #expect(allDebridRequest.value(forHTTPHeaderField: "Authorization") == "Bearer all-token")
        #expect(allDebridRequest.url?.query?.contains("apikey=") != true)

        let premiumizeAccountRequest = try #require(capturedRequests["/api/account/info"])
        #expect(premiumizeAccountRequest.value(forHTTPHeaderField: "Authorization") == "Bearer pm-token")
        #expect(premiumizeAccountRequest.url?.query?.contains("apikey=") != true)

        let premiumizeDirectRequest = try #require(capturedRequests["/api/transfer/directdl"])
        let body = requestBodyString(from: premiumizeDirectRequest)
        #expect(body.contains("src_id=transfer123"))
        #expect(!body.contains("magnet:?xt=urn:btih:"))
        #expect(premiumizeDirectRequest.url?.query?.contains("apikey=") != true)

        let torBoxRequest = try #require(capturedRequests["/v1/api/torrents/requestdl"])
        #expect(torBoxRequest.value(forHTTPHeaderField: "Authorization") == "Bearer tb-token")
        #expect(torBoxRequest.url?.query?.contains("token=") != true)
    }

    @Test("TorBox picks best file id from torrent file list")
    func torBoxSelectsBestFileID() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var requestDownloadURL: URL?

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""

            switch path {
            case "/v1/api/torrents/mylist":
                let body = """
                {
                  "data": {
                    "id": 55,
                    "download_state": "cached",
                    "files": [
                      {"id": 8, "name": "Movie.2026.sample.mkv", "size": 5000000000},
                      {"id": 12, "name": "Movie.2026.1080p.x264.mp4", "size": 2500000000},
                      {"id": 21, "name": "Movie.2026.Soundtrack.flac", "size": 150000000}
                    ]
                  }
                }
                """
                return try makeResponse(for: request, statusCode: 200, body: body)

            case "/v1/api/torrents/requestdl":
                requestDownloadURL = request.url
                let body = #"{"data":"https://torbox.example/movie.mp4"}"#
                return try makeResponse(for: request, statusCode: 200, body: body)

            default:
                return try makeResponse(for: request, statusCode: 404, body: "{}")
            }
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let torBox = TorBoxService(apiToken: "tb-token", session: session)
        let stream = try await torBox.getStreamURL(torrentId: "55")

        #expect(stream.fileName == "Movie.2026.1080p.x264.mp4")
        #expect(stream.quality == .hd1080p)
        #expect(stream.codec == .h264)
        #expect(requestDownloadURL?.query?.contains("file_id=12") == true)
    }

    @Test("TorBox falls back to file_id=0 when files are unavailable")
    func torBoxFallsBackToDefaultFileID() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var requestDownloadURL: URL?

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""

            switch path {
            case "/v1/api/torrents/mylist":
                let body = #"{"data":{"id":90,"download_state":"cached","files":[]}}"#
                return try makeResponse(for: request, statusCode: 200, body: body)

            case "/v1/api/torrents/requestdl":
                requestDownloadURL = request.url
                let body = #"{"data":"https://torbox.example/fallback.mp4"}"#
                return try makeResponse(for: request, statusCode: 200, body: body)

            default:
                return try makeResponse(for: request, statusCode: 404, body: "{}")
            }
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let torBox = TorBoxService(apiToken: "tb-token", session: session)
        _ = try await torBox.getStreamURL(torrentId: "90")

        #expect(requestDownloadURL?.query?.contains("file_id=0") == true)
    }

    @Test("TorBox throws instead of streaming file_id=0 when torrent is not ready")
    func torBoxThrowsWhenNotReady() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var didRequestDownload = false

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""

            switch path {
            case "/v1/api/torrents/mylist":
                // Non-terminal state with no files: must NOT fall back to file_id=0.
                let body = #"{"data":{"id":77,"download_state":"stalled (no seeds)","files":[]}}"#
                return try makeResponse(for: request, statusCode: 200, body: body)

            case "/v1/api/torrents/requestdl":
                didRequestDownload = true
                let body = #"{"data":"https://torbox.example/should-not-happen.mp4"}"#
                return try makeResponse(for: request, statusCode: 200, body: body)

            default:
                return try makeResponse(for: request, statusCode: 404, body: "{}")
            }
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let torBox = TorBoxService(apiToken: "tb-token", session: session)

        await #expect(throws: DebridError.self) {
            _ = try await torBox.getStreamURL(torrentId: "77")
        }
        #expect(didRequestDownload == false)
    }

    private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url else {
            throw NSError(domain: "DebridHTTPServiceTests", code: 1)
        }
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        ) else {
            throw NSError(domain: "DebridHTTPServiceTests", code: 2)
        }
        return (response, Data(body.utf8))
    }

    private func requestBodyString(from request: URLRequest) -> String {
        if let body = request.httpBody {
            return String(data: body, encoding: .utf8) ?? ""
        }

        guard let stream = request.httpBodyStream else {
            return ""
        }

        stream.open()
        defer { stream.close() }

        let bufferSize = 1024
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: bufferSize)

        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: bufferSize)
            guard read > 0 else { break }
            data.append(buffer, count: read)
        }

        return String(data: data, encoding: .utf8) ?? ""
    }
}
