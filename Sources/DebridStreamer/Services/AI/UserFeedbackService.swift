import Foundation

actor UserFeedbackService {
    private let database: DatabaseManager?
    private let metadataService: TMDBService?
    private let renewalEvaluator = RenewalEvaluator()

    init(database: DatabaseManager?, metadataService: TMDBService?) {
        self.database = database
        self.metadataService = metadataService
    }

    func recordRecommendationFeedback(
        recommendation: AIMovieRecommendation,
        watchedState: WatchedState,
        feedbackScaleMode: FeedbackScaleMode,
        feedbackValue: Double?,
        source: FeedbackSource = .manual
    ) async {
        guard let database else { return }
        let resolvedMedia = await resolveMedia(for: recommendation)
        await recordFeedback(
            media: resolvedMedia,
            fallbackTitle: recommendation.title,
            watchedState: watchedState,
            feedbackScaleMode: feedbackScaleMode,
            feedbackValue: feedbackValue,
            source: source,
            database: database
        )
    }

    func recordAutoCompletion(
        mediaId: String,
        episodeId: String?,
        progressSeconds: Double,
        durationSeconds: Double?,
        completionThreshold: Double = 0.95
    ) async {
        guard let database else { return }
        guard progressSeconds.isFinite, progressSeconds > 0 else { return }
        guard let durationSeconds, durationSeconds.isFinite, durationSeconds > 0 else { return }
        guard progressSeconds / durationSeconds >= completionThreshold else { return }

        if let latest = try? await database.fetchLatestWatchedState(mediaId: mediaId, episodeId: episodeId),
           latest.source == .manual,
           latest.watchedState == .notWatched {
            return
        }

        if let latest = try? await database.fetchLatestWatchedState(mediaId: mediaId, episodeId: episodeId),
           latest.watchedState == .watched {
            return
        }

        let media = try? await database.fetchMedia(id: mediaId)
        await recordFeedback(
            media: media,
            fallbackTitle: media?.title ?? mediaId,
            watchedState: .watched,
            feedbackScaleMode: .none,
            feedbackValue: nil,
            episodeId: episodeId,
            source: .auto,
            database: database
        )
    }

    private func recordFeedback(
        media: MediaItem?,
        fallbackTitle: String,
        watchedState: WatchedState,
        feedbackScaleMode: FeedbackScaleMode,
        feedbackValue: Double?,
        episodeId: String? = nil,
        source: FeedbackSource,
        database: DatabaseManager
    ) async {
        let now = Date()
        let mediaId = media?.id
        let signal = normalizedSignal(
            watchedState: watchedState,
            mode: feedbackScaleMode,
            value: feedbackValue
        )

        var metadata: [String: String] = ["title": media?.title ?? fallbackTitle]
        if let year = media?.year {
            metadata["year"] = String(year)
        }

        let watchedEvent = TasteEvent(
            id: "taste-\(UUID().uuidString)",
            mediaId: mediaId,
            episodeId: episodeId,
            eventType: watchedState == .watched ? .watched : .notInterested,
            signalStrength: signal,
            watchedState: watchedState,
            feedbackScale: feedbackScaleMode,
            feedbackValue: feedbackValue,
            source: source,
            metadata: metadata,
            createdAt: now
        )
        try? await database.saveTasteEvent(watchedEvent)

        let liked = likedDecision(mode: feedbackScaleMode, value: feedbackValue)
        if let liked {
            let preferenceEvent = TasteEvent(
                id: "taste-\(UUID().uuidString)",
                mediaId: mediaId,
                episodeId: episodeId,
                eventType: liked ? .liked : .disliked,
                signalStrength: liked ? abs(signal) : -abs(signal),
                watchedState: watchedState,
                feedbackScale: feedbackScaleMode,
                feedbackValue: feedbackValue,
                source: source,
                metadata: metadata,
                createdAt: now
            )
            try? await database.saveTasteEvent(preferenceEvent)
        }

        guard watchedState == .watched, let media else { return }
        await addToWatchedFolder(media: media, database: database, at: now)
        await maybeAddToReleaseWait(media: media, liked: liked, database: database, at: now)
    }

    private func addToWatchedFolder(media: MediaItem, database: DatabaseManager, at date: Date) async {
        guard let watchedFolder = try? await database.fetchFolderByKind(listType: .favorites, kind: .watched) else {
            return
        }
        _ = try? await database.addOrUpsertLibraryEntryPreservingExistingFolders(
            mediaId: media.id,
            listType: .favorites,
            folderId: watchedFolder.id,
            addedAt: date
        )
    }

    private func maybeAddToReleaseWait(
        media: MediaItem,
        liked: Bool?,
        database: DatabaseManager,
        at date: Date
    ) async {
        guard media.type == .series else { return }
        guard liked == true else { return }
        guard let metadataService else { return }
        guard let releaseWaitFolder = try? await database.fetchFolderByKind(listType: .favorites, kind: .releaseWait) else {
            return
        }

        guard let renewalMetadata = try? await metadataService.getSeriesRenewalMetadata(id: media.id) else {
            return
        }

        let evaluation = renewalEvaluator.evaluateSeries(metadata: renewalMetadata, liked: true, now: date)
        guard evaluation.shouldAddToReleaseWait else { return }

        _ = try? await database.addOrUpsertLibraryEntryPreservingExistingFolders(
            mediaId: media.id,
            listType: .favorites,
            folderId: releaseWaitFolder.id,
            addedAt: date,
            releaseDateHint: evaluation.releaseDateHint,
            renewalStatus: evaluation.renewalStatus
        )
    }

    private func resolveMedia(for recommendation: AIMovieRecommendation) async -> MediaItem? {
        guard let database else { return nil }

        if let cached = await resolveCachedMedia(for: recommendation, database: database) {
            return cached
        }

        guard let metadataService else { return nil }
        let searchResult = try? await metadataService.search(query: recommendation.title, type: nil, page: 1)
        guard let preview = bestPreview(in: searchResult?.items ?? [], year: recommendation.year) else {
            return nil
        }

        let detail = try? await metadataService.getDetail(id: preview.id, type: preview.type)
        if let detail {
            try? await database.saveMedia(detail)
        }
        return detail
    }

    private func resolveCachedMedia(
        for recommendation: AIMovieRecommendation,
        database: DatabaseManager
    ) async -> MediaItem? {
        let candidates = (try? await database.searchMedia(query: recommendation.title, limit: 25)) ?? []
        guard !candidates.isEmpty else { return nil }

        let exactByYear = candidates.first {
            normalizedTitle($0.title) == normalizedTitle(recommendation.title)
                && (recommendation.year == nil || $0.year == recommendation.year)
        }
        if let exactByYear {
            return exactByYear
        }

        return candidates.first {
            normalizedTitle($0.title) == normalizedTitle(recommendation.title)
        }
    }

    private func bestPreview(in items: [MediaPreview], year: Int?) -> MediaPreview? {
        if let year, let exact = items.first(where: { $0.year == year }) {
            return exact
        }
        return items.first
    }

    private func normalizedTitle(_ value: String) -> String {
        value
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    private func likedDecision(mode: FeedbackScaleMode, value: Double?) -> Bool? {
        switch mode {
        case .none:
            return nil
        case .likeDislike:
            guard let value else { return nil }
            return value >= 0.5
        case .scale1to10:
            guard let value else { return nil }
            return value >= 6.0
        case .scale1to100:
            guard let value else { return nil }
            return value >= 60.0
        }
    }

    private func normalizedSignal(
        watchedState: WatchedState,
        mode: FeedbackScaleMode,
        value: Double?
    ) -> Double {
        switch mode {
        case .none:
            return watchedState == .watched ? 0.35 : -0.25
        case .likeDislike:
            guard let value else { return watchedState == .watched ? 0.35 : -0.25 }
            return value >= 0.5 ? 1.0 : -1.0
        case .scale1to10:
            guard let value else { return watchedState == .watched ? 0.35 : -0.25 }
            let clamped = min(max(value, 1), 10)
            return ((clamped - 1) / 9) * 2 - 1
        case .scale1to100:
            guard let value else { return watchedState == .watched ? 0.35 : -0.25 }
            let clamped = min(max(value, 1), 100)
            return ((clamped - 1) / 99) * 2 - 1
        }
    }
}
