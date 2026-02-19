import Foundation

/// Lightweight local retrieval used for assistant memory context ranking.
/// Uses hybrid lexical scoring + metadata weighting, with lexical-only fallback
/// when embeddings are unavailable.
struct LocalContextRetriever {
    func retrieve(
        query: String,
        chunks: [AssistantMemoryChunk],
        limit: Int
    ) -> [AssistantMemoryChunk] {
        guard !chunks.isEmpty else { return [] }
        let queryTokens = tokenize(query)

        if queryTokens.isEmpty {
            return Array(chunks
                .sorted {
                    if $0.importance != $1.importance {
                        return $0.importance > $1.importance
                    }
                    return $0.createdAt > $1.createdAt
                }
                .prefix(limit))
        }

        let scored = chunks.map { chunk -> (chunk: AssistantMemoryChunk, score: Double) in
            let lexical = lexicalScore(for: queryTokens, chunk: chunk)
            let recencyDays = Date().timeIntervalSince(chunk.createdAt) / 86_400
            let recencyWeight = max(0.2, 1.0 - min(recencyDays / 90.0, 0.8))
            let score = (lexical * 0.65) + (chunk.importance * 0.20) + (recencyWeight * 0.15)
            return (chunk, score)
        }

        return scored
            .sorted { $0.score > $1.score }
            .prefix(limit)
            .map(\.chunk)
    }

    private func lexicalScore(for queryTokens: [String], chunk: AssistantMemoryChunk) -> Double {
        let contentTokens = tokenize(chunk.content)
        let summaryTokens = tokenize(chunk.summary ?? "")
        let tagTokens = chunk.tags.flatMap(tokenize)
        let bag = contentTokens + summaryTokens + tagTokens
        guard !bag.isEmpty else { return 0 }

        let bagSet = Set(bag)
        let overlap = Double(queryTokens.filter { bagSet.contains($0) }.count)
        return overlap / Double(max(1, queryTokens.count))
    }

    private func tokenize(_ text: String) -> [String] {
        text
            .lowercased()
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init)
            .filter { $0.count > 1 }
    }
}
