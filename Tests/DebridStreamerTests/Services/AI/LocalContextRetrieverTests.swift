import Testing
import Foundation
@testable import DebridStreamer

@Suite("LocalContextRetriever Tests")
struct LocalContextRetrieverTests {
    @Test("Lexical overlap ranks relevant chunks first")
    func lexicalRanking() {
        let retriever = LocalContextRetriever()
        let chunks = [
            AssistantMemoryChunk(
                id: "a",
                scope: "default",
                content: "User likes cerebral sci-fi with political drama.",
                summary: "cerebral sci-fi",
                tags: ["sci-fi", "drama"],
                importance: 0.4,
                createdAt: Date()
            ),
            AssistantMemoryChunk(
                id: "b",
                scope: "default",
                content: "User wants broad comedy recommendations.",
                summary: "broad comedy",
                tags: ["comedy"],
                importance: 0.9,
                createdAt: Date()
            )
        ]

        let ranked = retriever.retrieve(query: "sci-fi movies", chunks: chunks, limit: 2)
        #expect(ranked.first?.id == "a")
    }

    @Test("Empty query falls back to importance and recency")
    func emptyQueryFallback() {
        let retriever = LocalContextRetriever()
        let oldDate = Date().addingTimeInterval(-3600 * 24 * 20)
        let chunks = [
            AssistantMemoryChunk(
                id: "low",
                scope: "default",
                content: "Low importance",
                importance: 0.1,
                createdAt: Date()
            ),
            AssistantMemoryChunk(
                id: "high",
                scope: "default",
                content: "High importance",
                importance: 0.9,
                createdAt: oldDate
            )
        ]

        let ranked = retriever.retrieve(query: "   ", chunks: chunks, limit: 2)
        #expect(ranked.first?.id == "high")
    }
}
