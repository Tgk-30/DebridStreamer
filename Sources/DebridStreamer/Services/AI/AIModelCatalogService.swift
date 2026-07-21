import Foundation

enum AIModelCatalogServiceError: Error, LocalizedError, Equatable {
    case missingAPIKey(provider: String)
    case invalidResponse(provider: String)
    case requestFailed(provider: String, statusCode: Int)
    case decodingFailed(provider: String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey(let provider):
            return "\(provider) API key is required."
        case .invalidResponse(let provider):
            return "Invalid \(provider) response."
        case .requestFailed(let provider, let statusCode):
            return "\(provider) request failed with status \(statusCode)."
        case .decodingFailed(let provider):
            return "Unable to decode \(provider) model catalog."
        }
    }
}

actor AIModelCatalogService {
    private let session: URLSession

    // TTL cache of fetched model-ID lists keyed by (provider, apiKey). Reopening
    // Settings re-requests the catalog; within the TTL we serve the prior result
    // instead of re-hitting OpenAI/Anthropic `/models`. Only successful fetches
    // are cached (errors are never stored), so a failed/expired key is always
    // retried. Keyed on the apiKey so swapping keys never serves a stale list.
    private var cache: [String: (expiresAt: Date, ids: [String])] = [:]
    private let cacheTTL: TimeInterval = 60 * 10

    init(session: URLSession = AppHTTP.api) {
        self.session = session
    }

    private func cachedIDs(forKey key: String) -> [String]? {
        guard let entry = cache[key], entry.expiresAt > Date() else { return nil }
        return entry.ids
    }

    private func storeIDs(_ ids: [String], forKey key: String) {
        let now = Date()
        cache = cache.filter { $0.value.expiresAt > now }
        cache[key] = (expiresAt: now.addingTimeInterval(cacheTTL), ids: ids)
    }

    func fetchOpenAIModelIDs(apiKey: String) async throws -> [String] {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw AIModelCatalogServiceError.missingAPIKey(provider: "OpenAI")
        }

        let cacheKey = "openai|\(trimmed)"
        if let cached = cachedIDs(forKey: cacheKey) {
            return cached
        }

        guard let url = URL(string: "https://api.openai.com/v1/models") else {
            throw AIModelCatalogServiceError.invalidResponse(provider: "OpenAI")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(trimmed)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AIModelCatalogServiceError.invalidResponse(provider: "OpenAI")
        }
        guard (200...299).contains(http.statusCode) else {
            throw AIModelCatalogServiceError.requestFailed(provider: "OpenAI", statusCode: http.statusCode)
        }

        let ids = try parseModelIDs(data: data, preferredRootKeys: ["data", "models"])
        let filtered = ids.filter { id in
            let normalized = id.trimmingCharacters(in: .whitespacesAndNewlines)
            let lower = normalized.lowercased()
            if lower.hasPrefix("gpt") || lower.hasPrefix("o1") || lower.hasPrefix("o3") || lower.hasPrefix("o4") {
                return true
            }
            return false
        }
        let result = deduplicated(sortedDescending(filtered))
        storeIDs(result, forKey: cacheKey)
        return result
    }

    func fetchAnthropicModelIDs(apiKey: String) async throws -> [String] {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw AIModelCatalogServiceError.missingAPIKey(provider: "Anthropic")
        }

        let cacheKey = "anthropic|\(trimmed)"
        if let cached = cachedIDs(forKey: cacheKey) {
            return cached
        }

        guard let url = URL(string: "https://api.anthropic.com/v1/models") else {
            throw AIModelCatalogServiceError.invalidResponse(provider: "Anthropic")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(trimmed, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AIModelCatalogServiceError.invalidResponse(provider: "Anthropic")
        }
        guard (200...299).contains(http.statusCode) else {
            throw AIModelCatalogServiceError.requestFailed(provider: "Anthropic", statusCode: http.statusCode)
        }

        let ids = try parseModelIDs(data: data, preferredRootKeys: ["data", "models"])
        let filtered = ids.filter { $0.lowercased().contains("claude") }
        let result = deduplicated(sortedDescending(filtered))
        storeIDs(result, forKey: cacheKey)
        return result
    }

    private func parseModelIDs(data: Data, preferredRootKeys: [String]) throws -> [String] {
        let object = try JSONSerialization.jsonObject(with: data)

        if let rows = object as? [[String: Any]] {
            return rows.compactMap { $0["id"] as? String }
        }

        guard let dictionary = object as? [String: Any] else {
            throw AIModelCatalogServiceError.decodingFailed(provider: "AI")
        }

        for key in preferredRootKeys {
            if let rows = dictionary[key] as? [[String: Any]] {
                return rows.compactMap { $0["id"] as? String }
            }
        }

        if let nested = dictionary["data"] as? [String: Any],
           let rows = nested["models"] as? [[String: Any]] {
            return rows.compactMap { $0["id"] as? String }
        }

        throw AIModelCatalogServiceError.decodingFailed(provider: "AI")
    }

    private func deduplicated(_ values: [String]) -> [String] {
        var seen = Set<String>()
        var output: [String] = []
        for value in values {
            let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalized.isEmpty else { continue }
            let key = normalized.lowercased()
            if seen.insert(key).inserted {
                output.append(normalized)
            }
        }
        return output
    }

    private func sortedDescending(_ values: [String]) -> [String] {
        values.sorted { lhs, rhs in
            lhs.localizedCaseInsensitiveCompare(rhs) == .orderedDescending
        }
    }
}
