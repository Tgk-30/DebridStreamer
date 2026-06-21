import Foundation

/// Real-Debrid API integration.
/// API docs: https://api.real-debrid.com/
actor RealDebridService: DebridServiceProtocol {
    let serviceType = DebridServiceType.realDebrid
    private let apiToken: String
    private let baseURL = "https://api.real-debrid.com/rest/1.0"
    private let session: URLSession

    // Reused across calls instead of allocating per `getAccountInfo`.
    private static let expirationFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    init(apiToken: String, session: URLSession = AppHTTP.api) {
        self.apiToken = apiToken
        self.session = session
    }

    // MARK: - Cache Check

    func checkCache(hashes: [String]) async throws -> [String: CacheStatus] {
        guard !hashes.isEmpty else { return [:] }

        // RD has disabled /torrents/instantAvailability (error_code 37).
        // Instead, we return .unknown for all hashes — the resolve flow
        // handles both cached and uncached torrents correctly.
        // Cached torrents become "downloaded" almost instantly after addMagnet + selectFiles.
        var results: [String: CacheStatus] = [:]
        for hash in hashes {
            results[hash.lowercased()] = .unknown
        }
        return results
    }

    // MARK: - Magnet Operations

    func addMagnet(hash: String) async throws -> String {
        let magnet = "magnet:?xt=urn:btih:\(hash)"
        let encodedMagnet = magnet.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? magnet
        let body = "magnet=\(encodedMagnet)"

        // Retry with exponential backoff for transient server errors
        let maxRetries = 5
        var lastError: Error?
        for attempt in 0..<maxRetries {
            do {
                let data = try await requestRaw(path: "/torrents/addMagnet", method: "POST", body: body)

                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let id = json["id"] as? String {
                    return id
                }
                throw DebridError.downloadFailed("Failed to parse magnet response")
            } catch let error as DebridError {
                lastError = error
                if case .httpError(let code, _) = error, (500...599).contains(code) {
                    let delay = UInt64(pow(2.0, Double(attempt))) * 1_000_000_000
                    #if DEBUG
                    print("[RealDebrid] addMagnet HTTP \(code), attempt \(attempt + 1)/\(maxRetries), retrying...")
                    #endif
                    try await Task.sleep(nanoseconds: delay)
                    continue
                }
                throw error
            } catch {
                lastError = error
                break
            }
        }
        throw lastError ?? DebridError.downloadFailed("Failed to add magnet after \(maxRetries) retries")
    }

    func selectFiles(torrentId: String, fileIds: [Int]) async throws {
        let files = fileIds.isEmpty ? "all" : fileIds.map(String.init).joined(separator: ",")
        let body = "files=\(files)"

        // selectFiles returns 204 No Content on success; requestRaw already maps 204
        // to empty Data and returns it, so a successful call never throws. Any non-2xx
        // status is a real failure and must surface — don't swallow it.
        _ = try await requestRaw(path: "/torrents/selectFiles/\(torrentId)", method: "POST", body: body)
    }

    func getStreamURL(torrentId: String) async throws -> StreamInfo {
        // Poll for torrent status — cached torrents become "downloaded" almost instantly
        var status = ""
        var json: [String: Any] = [:]
        // Capped backoff between polls (seconds): start tight so cached torrents
        // resolve fast, then back off and cap at ~5s. Total wait (~21.7s for an
        // uncached torrent) stays comparable to the previous fixed 1s × ~19 schedule,
        // but with far fewer requests while waiting on slow downloads.
        let backoffSchedule: [Double] = [0.4, 0.8, 1.5, 3.0]
        let backoffCap = 5.0
        let maxAttempts = 20

        for attempt in 0..<maxAttempts {
            let data = try await requestRaw(path: "/torrents/info/\(torrentId)", method: "GET")

            guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw DebridError.torrentNotFound(torrentId)
            }
            json = parsed
            status = json["status"] as? String ?? ""

            #if DEBUG
            print("[RealDebrid] Torrent \(torrentId) status: \(status) (attempt \(attempt + 1)/\(maxAttempts))")
            #endif

            if status == "downloaded" {
                break
            }

            if status == "error" || status == "dead" || status == "virus" || status == "magnet_error" {
                throw DebridError.downloadFailed("Torrent status: \(status)")
            }

            // If waiting for file selection, select all files
            if status == "waiting_files_selection" {
                try await selectFiles(torrentId: torrentId, fileIds: [])
            }

            // Wait before next poll, using the capped backoff schedule.
            if attempt < maxAttempts - 1 {
                let delaySeconds = attempt < backoffSchedule.count ? backoffSchedule[attempt] : backoffCap
                try await Task.sleep(nanoseconds: UInt64(delaySeconds * 1_000_000_000))
            }
        }

        guard status == "downloaded" else {
            throw DebridError.downloadFailed("Torrent not ready. Status: \(status)")
        }

        guard let links = json["links"] as? [String], !links.isEmpty else {
            throw DebridError.noFilesAvailable
        }

        let candidates = fileCandidates(from: json, links: links)
        guard let selected = DebridFileSelector.selectBest(from: candidates) else {
            throw DebridError.noFilesAvailable
        }

        // Unrestrict the chosen link to get a direct stream URL
        let streamURL = try await unrestrict(link: selected.link)

        let filename = URL(fileURLWithPath: selected.fileName).lastPathComponent
        let bytes = selected.sizeBytes

        return StreamInfo(
            streamURL: streamURL.absoluteString,
            quality: VideoQuality.parse(from: filename),
            codec: VideoCodec.parse(from: filename),
            audio: AudioFormat.parse(from: filename),
            source: SourceType.parse(from: filename),
            sizeBytes: bytes,
            fileName: filename,
            debridService: "RD"
        )
    }

    private func fileCandidates(from json: [String: Any], links: [String]) -> [DebridFileCandidate] {
        if let files = json["files"] as? [[String: Any]] {
            let selectedFiles = files
                .filter { int64Value($0["selected"]) == 1 }
                .sorted { (lhs, rhs) in
                    int64Value(lhs["id"]) ?? Int64.max < int64Value(rhs["id"]) ?? Int64.max
                }

            var candidates: [DebridFileCandidate] = []
            for (index, link) in links.enumerated() where index < selectedFiles.count {
                let file = selectedFiles[index]
                let path = (file["path"] as? String) ?? (file["filename"] as? String) ?? "Unknown"
                let size = int64Value(file["bytes"]) ?? 0
                candidates.append(
                    DebridFileCandidate(link: link, fileName: path, sizeBytes: size)
                )
            }
            if !candidates.isEmpty {
                return candidates
            }
        }

        let fallbackName = json["filename"] as? String ?? "Unknown"
        let fallbackSize = int64Value(json["bytes"]) ?? 0
        return links.map {
            DebridFileCandidate(link: $0, fileName: fallbackName, sizeBytes: fallbackSize)
        }
    }

    // MARK: - Unrestrict

    func unrestrict(link: String) async throws -> URL {
        let encodedLink = link.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? link
        let body = "link=\(encodedLink)"

        // Retry for transient server errors
        let maxRetries = 5
        var lastError: Error?
        for attempt in 0..<maxRetries {
            do {
                let data = try await requestRaw(path: "/unrestrict/link", method: "POST", body: body)

                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let downloadStr = json["download"] as? String,
                   let downloadURL = URL(string: downloadStr) {
                    return downloadURL
                }
                throw DebridError.downloadFailed("Failed to parse unrestrict response")
            } catch let error as DebridError {
                lastError = error
                if case .httpError(let code, _) = error, (500...599).contains(code) {
                    let delay = UInt64(pow(2.0, Double(attempt))) * 1_000_000_000
                    #if DEBUG
                    print("[RealDebrid] unrestrict HTTP \(code), attempt \(attempt + 1)/\(maxRetries), retrying...")
                    #endif
                    try await Task.sleep(nanoseconds: delay)
                    continue
                }
                throw error
            } catch {
                lastError = error
                break
            }
        }
        throw lastError ?? DebridError.downloadFailed("Failed to unrestrict link after \(maxRetries) retries")
    }

    // MARK: - User Torrents

    /// Check if a hash already exists in the user's torrent list.
    /// Returns the torrent ID if found and status is "downloaded", nil otherwise.
    func findExistingTorrent(hash: String) async throws -> String? {
        // Bound the list instead of pulling the user's entire torrent history every
        // resolve. RD returns torrents newest-first, and a just-resolved torrent is
        // among the most recent, so the first page comfortably covers the realistic
        // "is this already here" case. A miss only costs a redundant addMagnet (which
        // RD dedups server-side), so correctness holds — this is purely an
        // optimization on the GET payload size.
        let data = try await requestRaw(path: "/torrents?limit=100&page=1", method: "GET")
        guard let torrents = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return nil
        }

        let lowerHash = hash.lowercased()
        for torrent in torrents {
            if let torrentHash = torrent["hash"] as? String,
               torrentHash.lowercased() == lowerHash,
               let id = torrent["id"] as? String {
                let status = torrent["status"] as? String ?? ""
                // Only return if already downloaded or has links
                if status == "downloaded" {
                    return id
                }
                // If it's in an error/dead state, delete it so we can re-add
                if status == "error" || status == "dead" || status == "magnet_error" {
                    try? await deleteTorrent(id: id)
                    return nil
                }
                // If it's in progress, return it so we can poll
                return id
            }
        }
        return nil
    }

    /// Delete a torrent from the user's list.
    func deleteTorrent(id: String) async throws {
        _ = try await requestRaw(path: "/torrents/delete/\(id)", method: "DELETE")
    }

    // MARK: - Account

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

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DebridError.invalidToken
        }

        let username = json["username"] as? String ?? "Unknown"
        let email = json["email"] as? String
        let premium = json["premium"] as? Int ?? 0
        let points = json["points"] as? Int

        var premiumExpiry: Date?
        if let expirationStr = json["expiration"] as? String {
            premiumExpiry = Self.expirationFormatter.date(from: expirationStr)
        }

        return DebridAccountInfo(
            username: username,
            email: email,
            premiumExpiry: premiumExpiry,
            isPremium: premium > 0,
            points: points
        )
    }

    // MARK: - HTTP

    private func requestRaw(path: String, method: String, body: String? = nil) async throws -> Data {
        guard let url = URL(string: baseURL + path) else {
            throw DebridError.networkError("Invalid URL: \(path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30

        if let body = body {
            request.httpBody = body.data(using: .utf8)
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw DebridError.networkError("Invalid response")
        }

        // 204 No Content is success (used by selectFiles, delete)
        if httpResponse.statusCode == 204 {
            return Data()
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                throw DebridError.invalidToken
            }
            if httpResponse.statusCode == 403 {
                throw DebridError.expired
            }
            if httpResponse.statusCode == 429 {
                throw DebridError.rateLimited
            }
            let errorMsg = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw DebridError.httpError(httpResponse.statusCode, errorMsg)
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

// MARK: - Array Chunking Helper

extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
