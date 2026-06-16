import Foundation

/// AllDebrid API integration.
/// API docs: https://docs.alldebrid.com/
actor AllDebridService: DebridServiceProtocol {
    let serviceType = DebridServiceType.allDebrid
    private let apiToken: String
    private let baseURL = "https://api.alldebrid.com/v4"
    private let session: URLSession
    private let agent = "DebridStreamer"

    init(apiToken: String, session: URLSession = AppHTTP.api) {
        self.apiToken = apiToken
        self.session = session
    }

    func checkCache(hashes: [String]) async throws -> [String: CacheStatus] {
        guard !hashes.isEmpty else { return [:] }

        var results: [String: CacheStatus] = [:]
        let chunks = hashes.chunked(into: 100)

        for chunk in chunks {
            let magnetsParam = chunk.map { "magnets[]=\($0)" }.joined(separator: "&")
            let data = try await requestRaw(
                path: "/magnet/instant",
                method: "GET",
                queryParams: magnetsParam
            )

            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let dataObj = json["data"] as? [String: Any],
               let magnets = dataObj["magnets"] as? [[String: Any]] {
                for magnetInfo in magnets {
                    let hash = (magnetInfo["hash"] as? String)?.lowercased() ?? ""
                    let instant = magnetInfo["instant"] as? Bool ?? false
                    if instant {
                        results[hash] = .cached(fileId: nil, fileName: nil, fileSize: nil)
                    } else {
                        results[hash] = .notCached
                    }
                }
            }
        }

        return results
    }

    func addMagnet(hash: String) async throws -> String {
        let magnet = "magnet:?xt=urn:btih:\(hash)"
        let body = "magnets[]=\(magnet.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? magnet)"
        let data = try await requestRaw(path: "/magnet/upload", method: "POST", body: body)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataObj = json["data"] as? [String: Any],
              let magnets = dataObj["magnets"] as? [[String: Any]],
              let first = magnets.first,
              let id = first["id"] as? Int else {
            throw DebridError.downloadFailed("Failed to add magnet to AllDebrid")
        }
        return String(id)
    }

    func selectFiles(torrentId: String, fileIds: [Int]) async throws {
        // AllDebrid auto-selects files; this is a no-op for most cases
    }

    func getStreamURL(torrentId: String) async throws -> StreamInfo {
        // Poll the magnet status until it becomes "Ready" (mirrors the bounded
        // retry loops used by Real-Debrid and TorBox). A freshly-added magnet is
        // rarely "Ready" on the first request, so a single read would fail for any
        // non-cached torrent.
        let maxAttempts = 20
        var magnets: [String: Any] = [:]
        for attempt in 0..<maxAttempts {
            let data = try await requestRaw(path: "/magnet/status", method: "GET", queryParams: "id=\(torrentId)")
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let dataObj = json["data"] as? [String: Any],
                  let magnet = dataObj["magnets"] as? [String: Any] else {
                throw DebridError.torrentNotFound(torrentId)
            }
            magnets = magnet
            let status = (magnet["status"] as? String) ?? ""
            if status == "Ready" { break }
            // Terminal failure states — stop polling early.
            if status == "Error" || status.lowercased().contains("error") {
                throw DebridError.downloadFailed("AllDebrid reported status: \(status)")
            }
            if attempt == maxAttempts - 1 {
                throw DebridError.downloadFailed("Torrent not ready after \(maxAttempts)s (status: \(status))")
            }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }

        guard let links = magnets["links"] as? [[String: Any]] else {
            throw DebridError.noFilesAvailable
        }

        let candidates = links.compactMap { item -> DebridFileCandidate? in
            guard let link = item["link"] as? String else { return nil }
            let filename = item["filename"] as? String ?? "Unknown"
            let size = int64Value(item["size"]) ?? 0
            return DebridFileCandidate(link: link, fileName: filename, sizeBytes: size)
        }
        guard let selected = DebridFileSelector.selectBest(from: candidates) else {
            throw DebridError.noFilesAvailable
        }

        let streamURL = try await unrestrict(link: selected.link)
        let filename = selected.fileName
        let size = selected.sizeBytes

        return StreamInfo(
            streamURL: streamURL.absoluteString,
            quality: VideoQuality.parse(from: filename),
            codec: VideoCodec.parse(from: filename),
            audio: AudioFormat.parse(from: filename),
            source: SourceType.parse(from: filename),
            sizeBytes: size,
            fileName: filename,
            debridService: "AD"
        )
    }

    func unrestrict(link: String) async throws -> URL {
        let body = "link=\(link.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? link)"
        let data = try await requestRaw(path: "/link/unlock", method: "POST", body: body)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataObj = json["data"] as? [String: Any],
              let downloadStr = dataObj["link"] as? String,
              let url = URL(string: downloadStr) else {
            throw DebridError.downloadFailed("Failed to unrestrict link on AllDebrid")
        }
        return url
    }

    func validateToken() async throws -> Bool {
        do {
            _ = try await getAccountInfo()
            return true
        } catch {
            return false
        }
    }

    func getAccountInfo() async throws -> DebridAccountInfo {
        let data = try await requestRaw(path: "/user", method: "GET")

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataObj = json["data"] as? [String: Any],
              let user = dataObj["user"] as? [String: Any] else {
            throw DebridError.invalidToken
        }

        let username = user["username"] as? String ?? "Unknown"
        let email = user["email"] as? String
        let isPremium = user["isPremium"] as? Bool ?? false

        var premiumExpiry: Date?
        if let expiryTimestamp = user["premiumUntil"] as? TimeInterval {
            premiumExpiry = Date(timeIntervalSince1970: expiryTimestamp)
        }

        return DebridAccountInfo(
            username: username,
            email: email,
            premiumExpiry: premiumExpiry,
            isPremium: isPremium
        )
    }

    // MARK: - HTTP

    private func requestRaw(path: String, method: String, queryParams: String? = nil, body: String? = nil) async throws -> Data {
        var urlStr = baseURL + path + "?agent=\(agent)"
        if let queryParams = queryParams, !queryParams.isEmpty {
            urlStr += "&\(queryParams)"
        }

        guard let url = URL(string: urlStr) else {
            throw DebridError.networkError("Invalid URL: \(path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue(apiToken, forHTTPHeaderField: "X-API-Key")

        if let body = body {
            let authBodyComponent = "apikey=\(apiToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? apiToken)"
            let composedBody = body.isEmpty ? authBodyComponent : "\(body)&\(authBodyComponent)"
            request.httpBody = composedBody.data(using: .utf8)
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw DebridError.networkError("Invalid response")
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                throw DebridError.invalidToken
            }
            throw DebridError.httpError(httpResponse.statusCode, String(data: data, encoding: .utf8) ?? "")
        }

        return data
    }

    private func int64Value(_ value: Any?) -> Int64? {
        if let number = value as? NSNumber {
            return number.int64Value
        }
        if let intValue = value as? Int {
            return Int64(intValue)
        }
        if let stringValue = value as? String {
            return Int64(stringValue)
        }
        return nil
    }
}
