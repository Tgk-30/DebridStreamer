import Foundation

struct RenewalEvaluationResult: Sendable, Equatable {
    var shouldAddToReleaseWait: Bool
    var renewalStatus: String?
    var releaseDateHint: String?
}

struct RenewalEvaluator: Sendable {
    func evaluateSeries(
        metadata: TMDBSeriesRenewalMetadata,
        liked: Bool,
        now: Date = Date()
    ) -> RenewalEvaluationResult {
        guard liked else {
            return RenewalEvaluationResult(
                shouldAddToReleaseWait: false,
                renewalStatus: metadata.status,
                releaseDateHint: nil
            )
        }

        let normalizedStatus = metadata.status?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        let hasFutureEpisode: Bool
        if let nextDate = metadata.nextEpisodeAirDate,
           let parsed = parseDate(nextDate) {
            hasFutureEpisode = parsed > now
        } else {
            hasFutureEpisode = false
        }

        let statusImpliesRenewal =
            metadata.inProduction == true
            || (normalizedStatus?.contains("returning") == true)
            || (normalizedStatus?.contains("in production") == true)
            || (normalizedStatus?.contains("planned") == true)
            || (normalizedStatus?.contains("pilot") == true)

        let shouldAdd = hasFutureEpisode || statusImpliesRenewal
        return RenewalEvaluationResult(
            shouldAddToReleaseWait: shouldAdd,
            renewalStatus: metadata.status,
            releaseDateHint: metadata.nextEpisodeAirDate
        )
    }

    private func parseDate(_ value: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: value)
    }
}
