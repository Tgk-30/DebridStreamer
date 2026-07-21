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

    @Test("Mini model fallback uses mini rate")
    func miniModelFallbackUsesMiniRate() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "custom-model-mini",
            inputTokens: 1_000,
            outputTokens: 2_000,
            totalTokens: nil
        )

        let expected = (1_000.0 / 1_000_000) * 0.50 + (2_000.0 / 1_000_000) * 2.00
        #expect(abs((estimated ?? 0) - expected) < 0.0000001)
    }

    @Test("Haiku model fallback uses haiku rate")
    func haikuModelFallbackUsesHaikuRate() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "super-haiku-engine",
            inputTokens: 1_000,
            outputTokens: 2_000,
            totalTokens: nil
        )

        let expected = (1_000.0 / 1_000_000) * 1.00 + (2_000.0 / 1_000_000) * 5.00
        #expect(abs((estimated ?? 0) - expected) < 0.0000001)
    }

    @Test("Sonnet model fallback uses sonnet rate")
    func sonnetModelFallbackUsesSonnetRate() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "ultra-sonnet-5",
            inputTokens: 2_000,
            outputTokens: 3_000,
            totalTokens: nil
        )

        let expected = (2_000.0 / 1_000_000) * 3.00 + (3_000.0 / 1_000_000) * 15.00
        #expect(abs((estimated ?? 0) - expected) < 0.0000001)
    }

    @Test("Opus model fallback uses opus rate")
    func opusModelFallbackUsesOpusRate() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "my-opus-preview",
            inputTokens: 3_000,
            outputTokens: 4_000,
            totalTokens: nil
        )

        let expected = (3_000.0 / 1_000_000) * 5.00 + (4_000.0 / 1_000_000) * 25.00
        #expect(abs((estimated ?? 0) - expected) < 0.0000001)
    }

    @Test("Unknown model with zero total tokens returns nil")
    func unknownModelWithNoTokensReturnsNil() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "unknown",
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: nil
        )
        #expect(estimated == nil)
    }

    @Test("Known model names normalize case and surrounding whitespace")
    func knownModelNormalization() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "  GPT-4.1-Mini  ",
            inputTokens: 1_000,
            outputTokens: 1_000,
            totalTokens: 2_000
        )
        #expect(estimated != nil)
        let expected = (1_000.0 / 1_000_000) * 0.40 + (1_000.0 / 1_000_000) * 1.60
        #expect(abs((estimated ?? 0) - expected) < 0.0000001)
    }

    @Test("Unknown model uses fallback when model string is empty")
    func emptyModelFallsBackToUnknownEstimator() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "   ",
            inputTokens: 1_000,
            outputTokens: 2_000,
            totalTokens: 3_000
        )
        let expected = (3_000.0 / 1_000_000) * 2.00
        #expect(estimated != nil)
        #expect(abs((estimated ?? 0) - expected) < 0.0000001)
    }

    @Test("Negative token values clamp to zero")
    func negativeTokensClampToZero() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "gpt-4.1",
            inputTokens: -10,
            outputTokens: -20,
            totalTokens: -30
        )
        #expect(estimated == nil)
    }

    @Test("Output tokens default from totalTokens when output token is nil")
    func outputDefaultsFromTotalTokens() {
        let estimated = AIUsageCostEstimator.estimateUSD(
            model: "gpt-4o",
            inputTokens: 500,
            outputTokens: nil,
            totalTokens: 1_500
        )
        let expected = (500.0 / 1_000_000) * 2.50 + (1_000.0 / 1_000_000) * 10.00
        #expect(estimated != nil)
        #expect(abs((estimated ?? 0) - expected) < 0.0000001)
    }
}
