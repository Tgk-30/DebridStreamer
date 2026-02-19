import Foundation

/// Premiumize API integration.
/// API docs: https://www.premiumize.me/api
actor PremiumizeService: DebridServiceProtocol {
    let serviceType = DebridServiceType.premiumize
    private let apiToken: String
    private let baseURL = "https://www.premiumize.me/api"
    private let session: URLSession

    init(apiToken: String, session: URLSession = .shared) {
        self.apiToken = apiToken
        self.session = session
    }

    func checkCache(hashes: [String]) async throws -> [String: CacheStatus] {
        guard !hashes.isEmpty else { return [:] }

        var results: [String: CacheStatus] = [:]
        let chunks = hashes.chunked(into: 100)

        for chunk in chunks {
            let itemsParam = chunk.map { "items[]=\($0)" }.joined(separator: "&")
            let data = try await requestRaw(path: "/cache/check", method: "GET", queryParams: itemsParam)

            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let response = json["response"] as? [Bool],
               let filenames = json["filename"] as? [String?],
               let filesizes = json["filesize"] as? [Int64?] {
                for (i, hash) in chunk.enumerated() where i < response.count {
                    let lowerHash = hash.lowercased()
                    if response[i] {
                        let name = i < filenames.count ? filenames[i] : nil
                        let size = i < filesizes.count ? filesizes[i] : nil
                        results[lowerHash] = .cached(fileId: nil, fileName: name, fileSize: size)
                    } else {
                        results[lowerHash] = .notCached
                    }
                }
            }
        }

        return results
    }

    func addMagnet(hash: String) async throws -> String {
        let magnet = "magnet:?xt=urn:btih:\(hash)"
        let body = "src=\(magnet.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? magnet)"
        let data = try await requestRaw(path: "/transfer/create", method: "POST", body: body)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = json["id"] as? String else {
            throw DebridError.downloadFailed("Failed to add magnet to Premiumize")
        }
        return id
    }

    func selectFiles(torrentId: String, fileIds: [Int]) async throws {
        // Premiumize doesn't require file selection
    }

    func getStreamURL(torrentId: String) async throws -> StreamInfo {
        let encodedId = torrentId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? torrentId
        let data = try await requestRaw(
            path: "/transfer/directdl",
            method: "POST",
            body: "src_id=\(encodedId)"
        )

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let content = json["content"] as? [[String: Any]] else {
            throw DebridError.noFilesAvailable
        }

        let candidates = content.compactMap { item -> DebridFileCandidate? in
            guard let link = item["link"] as? String else { return nil }
            let path = item["path"] as? String ?? "Unknown"
            let size = int64Value(item["size"]) ?? 0
            return DebridFileCandidate(link: link, fileName: path, sizeBytes: size)
        }
        guard let selected = DebridFileSelector.selectBest(from: candidates) else {
            throw DebridError.noFilesAvailable
        }

        let filename = URL(fileURLWithPath: selected.fileName).lastPathComponent
        let size = selected.sizeBytes

        return StreamInfo(
            streamURL: selected.link,
            quality: VideoQuality.parse(from: filename),
            codec: VideoCodec.parse(from: filename),
            audio: AudioFormat.parse(from: filename),
            source: SourceType.parse(from: filename),
            sizeBytes: size,
            fileName: filename,
            debridService: "PM"
        )
    }

    func unrestrict(link: String) async throws -> URL {
        // Premiumize doesn't have a separate unrestrict — directdl handles it
        guard let url = URL(string: link) else {
            throw DebridError.downloadFailed("Invalid link")
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
        let data = try await requestRaw(path: "/account/info", method: "GET")

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DebridError.invalidToken
        }

        let customerId = json["customer_id"] as? String ?? "Unknown"
        let premiumUntil = json["premium_until"] as? TimeInterval

        return DebridAccountInfo(
            username: customerId,
            email: nil,
            premiumExpiry: premiumUntil.map { Date(timeIntervalSince1970: $0) },
            isPremium: premiumUntil != nil
        )
    }

    // MARK: - HTTP

    private func requestRaw(path: String, method: String, queryParams: String? = nil, body: String? = nil) async throws -> Data {
        var urlStr = baseURL + path
        if let queryParams = queryParams, !queryParams.isEmpty {
            urlStr += "?\(queryParams)"
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
