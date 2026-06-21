import Foundation

/// TorBox API integration.
/// API docs: https://torbox.app/api
actor TorBoxService: DebridServiceProtocol {
    let serviceType = DebridServiceType.torBox
    private let apiToken: String
    private let baseURL = "https://api.torbox.app/v1/api"
    private let session: URLSession

    private struct TorrentFileEntry {
        let id: Int
        let name: String
        let sizeBytes: Int64
    }

    private struct TorrentSnapshot {
        let state: String
        let files: [TorrentFileEntry]
    }

    // Reused across calls instead of allocating per `getAccountInfo`.
    private static let premiumExpiryFormatter = ISO8601DateFormatter()

    init(apiToken: String, session: URLSession = AppHTTP.api) {
        self.apiToken = apiToken
        self.session = session
    }

    func checkCache(hashes: [String]) async throws -> [String: CacheStatus] {
        guard !hashes.isEmpty else { return [:] }

        var results: [String: CacheStatus] = [:]
        let chunks = hashes.chunked(into: 100)

        for chunk in chunks {
            let hashParam = chunk.joined(separator: ",")
            let data = try await requestRaw(
                path: "/torrents/checkcached",
                method: "GET",
                queryParams: "hash=\(hashParam)&format=object"
            )

            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let dataObj = json["data"] as? [String: Any] {
                for hash in chunk {
                    let lowerHash = hash.lowercased()
                    if let _ = dataObj[lowerHash] {
                        results[lowerHash] = .cached(fileId: nil, fileName: nil, fileSize: nil)
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
        let body = "magnet=\(magnet.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? magnet)"
        let data = try await requestRaw(path: "/torrents/createtorrent", method: "POST", body: body)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataObj = json["data"] as? [String: Any],
              let id = dataObj["torrent_id"] as? Int else {
            throw DebridError.downloadFailed("Failed to add magnet to TorBox")
        }
        return String(id)
    }

    func selectFiles(torrentId: String, fileIds: [Int]) async throws {
        // TorBox handles file selection during creation
    }

    func getStreamURL(torrentId: String) async throws -> StreamInfo {
        let maxAttempts = 20
        let terminalReadyStates: Set<String> = ["cached", "completed", "uploading"]
        var selectedFile: TorrentFileEntry?
        var lastState = ""

        for attempt in 0..<maxAttempts {
            let snapshot = try await getTorrentSnapshot(torrentId: torrentId)
            lastState = snapshot.state.lowercased()
            if let best = bestFile(from: snapshot.files) {
                selectedFile = best
                break
            }

            if lastState.contains("stalled") {
                throw DebridError.downloadFailed("Torrent stalled: \(snapshot.state)")
            }

            // If the torrent is already complete/cached but file metadata is missing,
            // skip waiting and fall back to TorBox default file selection.
            if terminalReadyStates.contains(lastState) {
                break
            }

            if attempt < maxAttempts - 1 {
                try await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }

        // Only fall back to file_id=0 when we have no concrete file AND the torrent
        // reached a terminal/ready state. If it's still processing (or in an unknown
        // non-terminal state) after exhausting attempts, surface a failure instead of
        // blindly streaming file 0.
        if selectedFile == nil && !terminalReadyStates.contains(lastState) {
            throw DebridError.downloadFailed("Torrent not ready: \(lastState.isEmpty ? "unknown" : lastState)")
        }

        let fallbackId = 0
        let fileId = selectedFile?.id ?? fallbackId
        let fileName = selectedFile?.name ?? "TorBox Stream"
        let size = selectedFile?.sizeBytes ?? 0

        let data = try await requestRaw(
            path: "/torrents/requestdl",
            method: "GET",
            queryParams: "torrent_id=\(torrentId)&file_id=\(fileId)&zip_link=false"
        )

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataStr = json["data"] as? String else {
            throw DebridError.noFilesAvailable
        }

        return StreamInfo(
            streamURL: dataStr,
            quality: VideoQuality.parse(from: fileName),
            codec: VideoCodec.parse(from: fileName),
            audio: AudioFormat.parse(from: fileName),
            source: SourceType.parse(from: fileName),
            sizeBytes: size,
            fileName: fileName,
            debridService: "TB"
        )
    }

    func unrestrict(link: String) async throws -> URL {
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
        let data = try await requestRaw(path: "/user/me", method: "GET")

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataObj = json["data"] as? [String: Any] else {
            throw DebridError.invalidToken
        }

        let email = dataObj["email"] as? String ?? "Unknown"
        let premium = dataObj["plan"] as? Int ?? 0

        var premiumExpiry: Date?
        if let expiryStr = dataObj["premium_expires_at"] as? String {
            premiumExpiry = Self.premiumExpiryFormatter.date(from: expiryStr)
        }

        return DebridAccountInfo(
            username: email,
            email: email,
            premiumExpiry: premiumExpiry,
            isPremium: premium > 0
        )
    }

    // MARK: - HTTP

    private func requestRaw(path: String, method: String, queryParams: String? = nil, body: String? = nil) async throws -> Data {
        var urlStr = baseURL + path
        if let queryParams = queryParams {
            urlStr += "?\(queryParams)"
        }

        guard let url = URL(string: urlStr) else {
            throw DebridError.networkError("Invalid URL: \(path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")

        if let body = body {
            request.httpBody = body.data(using: .utf8)
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw DebridError.networkError("Invalid response")
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
                throw DebridError.invalidToken
            }
            throw DebridError.httpError(httpResponse.statusCode, String(data: data, encoding: .utf8) ?? "")
        }

        return data
    }

    private func getTorrentSnapshot(torrentId: String) async throws -> TorrentSnapshot {
        let data = try await requestRaw(
            path: "/torrents/mylist",
            method: "GET",
            queryParams: "id=\(torrentId)&bypass_cache=true"
        )

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DebridError.torrentNotFound(torrentId)
        }

        guard let torrentObject = extractTorrentObject(from: json, torrentId: torrentId) else {
            throw DebridError.torrentNotFound(torrentId)
        }

        let state = (torrentObject["download_state"] as? String) ?? ""
        let files = parseFiles(from: torrentObject["files"])
        return TorrentSnapshot(state: state, files: files)
    }

    private func extractTorrentObject(from json: [String: Any], torrentId: String) -> [String: Any]? {
        if let object = json["data"] as? [String: Any] {
            return object
        }

        guard let list = json["data"] as? [[String: Any]] else {
            return nil
        }

        if let torrentID = Int64(torrentId),
           let match = list.first(where: { int64Value($0["id"]) == torrentID }) {
            return match
        }

        return list.first
    }

    private func parseFiles(from rawFiles: Any?) -> [TorrentFileEntry] {
        guard let rawFiles = rawFiles as? [[String: Any]] else {
            return []
        }

        return rawFiles.compactMap { file in
            guard let fileId64 = int64Value(file["id"]) else {
                return nil
            }

            let name = (file["name"] as? String) ?? (file["short_name"] as? String) ?? "Unknown"
            let size = int64Value(file["size"]) ?? 0

            return TorrentFileEntry(
                id: Int(fileId64),
                name: name,
                sizeBytes: size
            )
        }
    }

    private func bestFile(from files: [TorrentFileEntry]) -> TorrentFileEntry? {
        guard !files.isEmpty else { return nil }

        let candidates = files.map { file in
            DebridFileCandidate(
                link: String(file.id),
                fileName: file.name,
                sizeBytes: file.sizeBytes
            )
        }

        guard let selected = DebridFileSelector.selectBest(from: candidates),
              let selectedId = Int(selected.link) else {
            return nil
        }

        return files.first { $0.id == selectedId }
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
