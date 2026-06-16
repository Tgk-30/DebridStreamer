import Foundation

struct AIUsageCostEstimator {
    struct Rate {
        let inputPerMillionUSD: Double
        let outputPerMillionUSD: Double
    }

    private static let knownRates: [String: Rate] = [
        // OpenAI
        "gpt-4.1": .init(inputPerMillionUSD: 2.00, outputPerMillionUSD: 8.00),
        "gpt-4.1-mini": .init(inputPerMillionUSD: 0.40, outputPerMillionUSD: 1.60),
        "gpt-4.1-nano": .init(inputPerMillionUSD: 0.10, outputPerMillionUSD: 0.40),
        "gpt-4o": .init(inputPerMillionUSD: 2.50, outputPerMillionUSD: 10.00),
        "gpt-4o-mini": .init(inputPerMillionUSD: 0.15, outputPerMillionUSD: 0.60),
        "o3": .init(inputPerMillionUSD: 10.00, outputPerMillionUSD: 40.00),
        "o4-mini": .init(inputPerMillionUSD: 1.10, outputPerMillionUSD: 4.40),

        // Anthropic (current generation, $/1M tokens)
        "claude-fable-5": .init(inputPerMillionUSD: 10.00, outputPerMillionUSD: 50.00),
        "claude-opus-4-8": .init(inputPerMillionUSD: 5.00, outputPerMillionUSD: 25.00),
        "claude-opus-4-7": .init(inputPerMillionUSD: 5.00, outputPerMillionUSD: 25.00),
        "claude-opus-4-6": .init(inputPerMillionUSD: 5.00, outputPerMillionUSD: 25.00),
        "claude-sonnet-4-6": .init(inputPerMillionUSD: 3.00, outputPerMillionUSD: 15.00),
        "claude-haiku-4-5": .init(inputPerMillionUSD: 1.00, outputPerMillionUSD: 5.00),
    ]

    static func estimateUSD(
        model: String?,
        inputTokens: Int?,
        outputTokens: Int?,
        totalTokens: Int?
    ) -> Double? {
        let normalizedModel = (model ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard !normalizedModel.isEmpty else { return estimateFromUnknownModel(totalTokens: totalTokens) }

        if let rate = knownRates[normalizedModel] {
            return estimate(rate: rate, inputTokens: inputTokens, outputTokens: outputTokens, totalTokens: totalTokens)
        }

        if normalizedModel.contains("mini") {
            return estimate(
                rate: .init(inputPerMillionUSD: 0.50, outputPerMillionUSD: 2.00),
                inputTokens: inputTokens,
                outputTokens: outputTokens,
                totalTokens: totalTokens
            )
        }
        if normalizedModel.contains("haiku") {
            return estimate(
                rate: .init(inputPerMillionUSD: 1.00, outputPerMillionUSD: 5.00),
                inputTokens: inputTokens,
                outputTokens: outputTokens,
                totalTokens: totalTokens
            )
        }
        if normalizedModel.contains("sonnet") {
            return estimate(
                rate: .init(inputPerMillionUSD: 3.00, outputPerMillionUSD: 15.00),
                inputTokens: inputTokens,
                outputTokens: outputTokens,
                totalTokens: totalTokens
            )
        }
        if normalizedModel.contains("opus") {
            return estimate(
                rate: .init(inputPerMillionUSD: 5.00, outputPerMillionUSD: 25.00),
                inputTokens: inputTokens,
                outputTokens: outputTokens,
                totalTokens: totalTokens
            )
        }

        return estimateFromUnknownModel(totalTokens: totalTokens)
    }

    private static func estimate(
        rate: Rate,
        inputTokens: Int?,
        outputTokens: Int?,
        totalTokens: Int?
    ) -> Double? {
        let input = max(0, inputTokens ?? totalTokens ?? 0)
        let output = max(0, outputTokens ?? max(0, (totalTokens ?? 0) - input))
        if input == 0, output == 0 {
            return nil
        }
        let inputCost = (Double(input) / 1_000_000) * rate.inputPerMillionUSD
        let outputCost = (Double(output) / 1_000_000) * rate.outputPerMillionUSD
        return inputCost + outputCost
    }

    private static func estimateFromUnknownModel(totalTokens: Int?) -> Double? {
        guard let totalTokens, totalTokens > 0 else { return nil }
        // Conservative fallback estimate to avoid zeroing unknown providers.
        return (Double(totalTokens) / 1_000_000) * 2.00
    }
}
