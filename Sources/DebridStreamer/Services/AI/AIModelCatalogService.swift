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

    init(session: URLSession = .shared) {
        self.session = session
    }

    func fetchOpenAIModelIDs(apiKey: String) async throws -> [String] {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw AIModelCatalogServiceError.missingAPIKey(provider: "OpenAI")
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
            let lower = id.lowercased()
            if lower.hasPrefix("gpt") || lower.hasPrefix("o1") || lower.hasPrefix("o3") || lower.hasPrefix("o4") {
                return true
            }
            return false
        }
        return deduplicated(sortedDescending(filtered))
    }

    func fetchAnthropicModelIDs(apiKey: String) async throws -> [String] {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw AIModelCatalogServiceError.missingAPIKey(provider: "Anthropic")
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
        return deduplicated(sortedDescending(filtered))
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
