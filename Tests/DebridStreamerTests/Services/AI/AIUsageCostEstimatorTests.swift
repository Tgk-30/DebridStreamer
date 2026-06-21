import Testing
@testable import DebridStreamer

@Suite("AIUsageCostEstimator Tests")
struct AIUsageCostEstimatorTests {
    @Test("Known model pricing produces non-zero estimate")
    func knownModelEstimate() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "gpt-4.1-mini",
            inputTokens: 1_000,
            outputTokens: 500,
            totalTokens: 1_500
        )
        #expect(estimated != nil)
        #expect((estimated ?? 0) > 0)
    }

    @Test("Unknown model falls back to total-token estimate")
    func unknownModelFallbackEstimate() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "unknown-model",
            inputTokens: nil,
            outputTokens: nil,
            totalTokens: 2_000
        )
        #expect(estimated != nil)
        #expect((estimated ?? 0) > 0)
    }

    @Test("No token usage returns nil")
    func noTokensReturnsNil() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "gpt-4.1-mini",
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0
        )
        #expect(estimated == nil)
    }
}
