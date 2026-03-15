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

        // Anthropic
        "claude-3-7-sonnet-latest": .init(inputPerMillionUSD: 3.00, outputPerMillionUSD: 15.00),
        "claude-3-5-sonnet-latest": .init(inputPerMillionUSD: 3.00, outputPerMillionUSD: 15.00),
        "claude-3-5-haiku-latest": .init(inputPerMillionUSD: 0.80, outputPerMillionUSD: 4.00),
        "claude-3-opus-latest": .init(inputPerMillionUSD: 15.00, outputPerMillionUSD: 75.00),
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
                rate: .init(inputPerMillionUSD: 0.80, outputPerMillionUSD: 4.00),
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
                rate: .init(inputPerMillionUSD: 15.00, outputPerMillionUSD: 75.00),
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
