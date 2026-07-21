import Testing
import Foundation
@testable import DebridStreamer

@Suite("AIAssistantManager Tests")
struct AIAssistantManagerTests {
    @Test("Compare mode returns per-provider and merged recommendations")
    func compareModeMerge() async throws {
        let openAIRec = [
            AIMovieRecommendation(title: "Dune", year: 2021, reason: "Epic", score: 0.9),
            AIMovieRecommendation(title: "Arrival", year: 2016, reason: "Smart", score: 0.8),
        ]
        let anthropicRec = [
            AIMovieRecommendation(title: "Arrival", year: 2016, reason: "Smart", score: 0.9),
            AIMovieRecommendation(title: "Interstellar", year: 2014, reason: "Scale", score: 0.85),
        ]

        let manager = AIAssistantManager(
            providers: [
                .openAI: MockAIProvider(kind: .openAI, recommendations: openAIRec),
                .anthropic: MockAIProvider(kind: .anthropic, recommendations: anthropicRec),
            ],
            database: nil,
            settings: nil,
            metadataProvider: nil
        )

        let result = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "Recommend sci-fi",
                maxResults: 5,
                compareMode: true,
                providers: [.openAI, .anthropic]
            )
        )

        #expect(result.usedFallback == false)
        #expect(result.providerResponses.count == 2)
        let mergedTitles = Set(result.mergedRecommendations.map(\.title))
        #expect(mergedTitles.contains("Dune"))
        #expect(mergedTitles.contains("Arrival"))
        #expect(mergedTitles.contains("Interstellar"))
    }

    @Test("Fallback recommendations are used when providers fail")
    func fallbackWhenProvidersFail() async throws {
        let db = try makeTestDatabase()
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        try await db.saveMedia(MediaItem(id: "tt100", type: .movie, title: "Fallback Title", year: 2025))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-fallback",
                mediaId: "tt100",
                progressSeconds: 300,
                durationSeconds: 5400,
                completed: false,
                lastWatched: Date()
            )
        )

        let manager = AIAssistantManager(
            providers: [.openAI: MockAIProvider(kind: .openAI, recommendations: [], shouldThrow: true)],
            database: db,
            settings: nil,
            metadataProvider: nil
        )

        let result = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "Anything",
                maxResults: 5,
                compareMode: true,
                providers: [.openAI]
            )
        )

        #expect(result.usedFallback == true)
        #expect(result.mergedRecommendations.isEmpty == false)
        #expect(result.mergedRecommendations.map(\.title).contains("Fallback Title"))
    }

    @Test("Provider failures are surfaced as errors on the provider response")
    func providerFailureSurfacesError() async throws {
        let manager = AIAssistantManager(
            providers: [.openAI: MockAIProvider(kind: .openAI, recommendations: [], shouldThrow: true)],
            database: nil,
            settings: nil,
            metadataProvider: nil
        )

        let result = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "Anything",
                maxResults: 5,
                compareMode: true,
                providers: [.openAI]
            )
        )

        // The failed provider is retained in providerResponses (so the UI can
        // distinguish "provider failed" from "no results") and carries the error.
        #expect(result.usedFallback == true)
        let failed = result.providerResponses.first { $0.provider == .openAI }
        #expect(failed?.recommendations.isEmpty == true)
        #expect(failed?.error == "failed")
    }

    @Test("Base local context is available even when personalization is disabled")
    func baseContextAvailableWithoutPersonalization() async throws {
        let db = try makeTestDatabase()
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "false")
        try await db.saveMedia(MediaItem(id: "tt200", type: .movie, title: "Context Film", year: 2024))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-ctx",
                mediaId: "tt200",
                progressSeconds: 300,
                durationSeconds: 7200,
                completed: false,
                lastWatched: Date()
            )
        )

        let captureProvider = CapturingProvider()
        let manager = AIAssistantManager(
            providers: [.openAI: captureProvider],
            database: db,
            settings: nil,
            metadataProvider: nil
        )

        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "Recommend something",
                maxResults: 5,
                compareMode: false,
                providers: [.openAI]
            )
        )
        let disabledCandidates = await captureProvider.snapshotCandidates()
        #expect(disabledCandidates.contains("Context Film"))

        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "Recommend something else",
                maxResults: 5,
                compareMode: false,
                providers: [.openAI]
            )
        )
        let enabledCandidates = await captureProvider.snapshotCandidates()
        #expect(enabledCandidates.contains("Context Film"))
    }

    @Test("Context changes invalidate recommendation cache")
    func cacheInvalidatesWhenPersonalizationContextChanges() async throws {
        let db = try makeTestDatabase()
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "false")
        try await db.saveMedia(MediaItem(id: "ttctx", type: .movie, title: "Context Shift", year: 2025))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-shift",
                mediaId: "ttctx",
                progressSeconds: 120,
                durationSeconds: 7200,
                completed: false,
                lastWatched: Date()
            )
        )

        let provider = RecordingProvider()
        let manager = AIAssistantManager(
            providers: [.openAI: provider],
            database: db,
            settings: nil,
            metadataProvider: nil
        )

        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "same prompt",
                maxResults: 5,
                compareMode: false,
                providers: [.openAI]
            )
        )

        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "same prompt",
                maxResults: 5,
                compareMode: false,
                providers: [.openAI]
            )
        )

        let calls = await provider.snapshots()
        #expect(calls.count == 2)
        #expect(calls[0].contains("Context Shift"))
        #expect(calls[1].contains("Context Shift"))
    }

    @Test("Assistant memory persistence is gated by personalization opt-in")
    func memoryPersistenceRespectsOptIn() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "false")

        let provider = MockAIProvider(
            kind: .openAI,
            recommendations: [AIMovieRecommendation(title: "Dune", year: 2021, reason: "Epic", score: 0.9)]
        )
        let manager = AIAssistantManager(
            providers: [.openAI: provider],
            database: db,
            settings: settings,
            metadataProvider: nil
        )

        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "recommend sci-fi",
                maxResults: 3,
                compareMode: false,
                providers: [.openAI]
            )
        )
        let disabledChunks = try await db.fetchAssistantMemoryChunks(scope: "default", limit: 20)
        #expect(disabledChunks.isEmpty)

        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "recommend sci-fi now",
                maxResults: 3,
                compareMode: false,
                providers: [.openAI]
            )
        )
        let enabledChunks = try await db.fetchAssistantMemoryChunks(scope: "default", limit: 20)
        #expect(enabledChunks.isEmpty == false)
    }

    @Test("Provider usage is persisted into settings usage totals")
    func providerUsagePersistsToSettingsTotals() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "false")

        let provider = UsageProvider()
        let manager = AIAssistantManager(
            providers: [.openAI: provider],
            database: db,
            settings: settings,
            metadataProvider: nil
        )

        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "recommend",
                maxResults: 3,
                compareMode: false,
                providers: [.openAI]
            )
        )

        #expect(try await settings.getAIUsageTotalInputTokens() == 100)
        #expect(try await settings.getAIUsageTotalOutputTokens() == 50)
        #expect(abs((try await settings.getAIUsageTotalEstimatedCostUSD()) - 0.003) < 0.000001)
    }

    @Test("hasAnyProvider reports when providers are configured")
    func hasAnyProviderReflectsConfiguredProviders() async {
        let managerWithProvider = AIAssistantManager(
            providers: [.openAI: MockAIProvider(kind: .openAI, recommendations: [])],
            database: nil,
            settings: nil,
            metadataProvider: nil
        )
        #expect(await managerWithProvider.hasAnyProvider)
        #expect(await managerWithProvider.availableProviders == [.openAI])

        let managerWithoutProvider = AIAssistantManager(
            providers: [:],
            database: nil,
            settings: nil,
            metadataProvider: nil
        )
        #expect(await managerWithoutProvider.hasAnyProvider == false)
        #expect(await managerWithoutProvider.availableProviders.isEmpty)
    }

    @Test("discoverFilters requires a configured provider")
    func discoverFiltersNeedsProvider() async {
        let manager = AIAssistantManager(
            providers: [:],
            database: nil,
            settings: nil,
            metadataProvider: StubMetadataProvider()
        )
        do {
            _ = try await manager.discoverFilters(from: "quiet thriller")
            Issue.record("Expected no provider error")
        } catch let error as AIAssistantManager.DiscoverPlanError {
            #expect(error == .noProvider)
            #expect(error.errorDescription == "No AI provider is configured. Add one in Settings.")
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("discoverFilters requires a metadata provider")
    func discoverFiltersNeedsMetadataProvider() async {
        let manager = AIAssistantManager(
            providers: [.openAI: DiscoverPlanProvider(kind: .openAI, rawText: "anything")],
            database: nil,
            settings: nil,
            metadataProvider: nil
        )

        do {
            _ = try await manager.discoverFilters(from: "dreamy sci-fi")
            Issue.record("Expected no metadata provider error")
        } catch let error as AIAssistantManager.DiscoverPlanError {
            #expect(error == .noMetadataProvider)
            #expect(error.errorDescription == "TMDB is not configured. Add your API key in Settings.")
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("discoverFilters rejects unparseable model output")
    func discoverFiltersRejectsUnparseableOutput() async {
        let manager = AIAssistantManager(
            providers: [.openAI: DiscoverPlanProvider(kind: .openAI, rawText: "not valid json")],
            database: nil,
            settings: nil,
            metadataProvider: StubMetadataProvider()
        )

        do {
            _ = try await manager.discoverFilters(from: "whatever")
            Issue.record("Expected unparseable model output error")
        } catch let error as AIAssistantManager.DiscoverPlanError {
            #expect(error == .modelUnparseable)
            #expect(error.errorDescription == "The assistant couldn't turn that into a search. Try rephrasing.")
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("discoverFilters parses discovery plans and resolves filters")
    func discoverFiltersParsesPlanAndResolvesOutputs() async throws {
        let metadata = QueryAwareMetadataProvider(
            searchByQuery: [:],
            keywordsByQuery: [
                "space": [
                    TMDBKeyword(id: 101, name: "Space"),
                    TMDBKeyword(id: 102, name: "nebula"),
                ]
            ],
            movieGenres: [],
            seriesGenres: [Genre(id: 18, name: "Drama"), Genre(id: 35, name: "Comedy")]
        )
        let raw = """
        {"mediaType":"tv","genres":["Drama"],"keywords":["space","ignored"],"yearFrom":2029,"yearTo":2021,"minRating":8.1,"sortBy":"vote_average.desc","summary":"   "}
        """
        let manager = AIAssistantManager(
            providers: [.openAI: DiscoverPlanProvider(kind: .openAI, rawText: raw)],
            database: nil,
            settings: nil,
            metadataProvider: metadata
        )
        let plan = try await manager.discoverFilters(from: "future noir")

        #expect(plan.mediaType == .series)
        #expect(plan.genreIds == [18])
        #expect(plan.keywordIds == [101])
        #expect(plan.yearGTE == 2021)
        #expect(plan.yearLTE == 2029)
        #expect(plan.summary == "Picks for \"future noir\"")
        #expect(plan.sortBy == .ratingDesc)
        #expect(plan.minRating == 8.1)
        #expect(plan.keywordNames == ["Space"])
    }

    @Test("predictAffinity returns no-provider error")
    func predictAffinityRequiresProvider() async {
        let manager = AIAssistantManager(
            providers: [:],
            database: nil,
            settings: nil,
            metadataProvider: nil
        )
        let item = MediaItem(id: "tt-aff", type: .movie, title: "Arrival")

        do {
            _ = try await manager.predictAffinity(for: item)
            Issue.record("Expected affinity no-provider error")
        } catch let error as AIAssistantManager.AffinityError {
            #expect(error == .noProvider)
            #expect(error.errorDescription == "No AI provider is configured. Add one in Settings.")
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("predictAffinity caches verdicts by item and personalization flag")
    func predictAffinityCachesByFlags() async throws {
        let db = try makeTestDatabase()
        let provider = CachedAffinityProvider(
            kind: .openAI,
            rawText: #"{"verdict":"yes","confidence":0.91,"reasoning":"Strong match"}"#
        )
        let manager = AIAssistantManager(
            providers: [.openAI: provider],
            database: db,
            settings: nil,
            metadataProvider: nil
        )

        let item = MediaItem(id: "tt-cache", type: .movie, title: "Arrival")
        let first = try await manager.predictAffinity(for: item)
        let second = try await manager.predictAffinity(for: item)

        #expect(first == second)
        #expect(await provider.callCount == 1)

        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        _ = try await manager.predictAffinity(for: item)
        #expect(await provider.callCount == 2)
    }

    @Test("predictAffinity includes watched history notes in the model prompt")
    func predictAffinityAddsWatchedAndHistoryNotes() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt-judge", type: .movie, title: "Judge Dredd", year: 1995))
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-judge",
                mediaId: "tt-judge",
                progressSeconds: 120,
                durationSeconds: 300,
                completed: false,
                lastWatched: Date()
            )
        )
        try await db.saveTasteEvent(
            TasteEvent(
                id: "te-judge",
                mediaId: "tt-judge",
                episodeId: nil,
                eventType: .rated,
                watchedState: .watched,
                feedbackScale: .scale1to10,
                feedbackValue: 8.2,
                createdAt: Date()
            )
        )

        let provider = CapturingPromptProvider(
            kind: .openAI,
            rawText: #"{"verdict":"yes","confidence":0.9,"reasoning":"Great for user"}"#
        )
        let manager = AIAssistantManager(
            providers: [.openAI: provider],
            database: db,
            settings: nil,
            metadataProvider: nil
        )

        _ = try await manager.predictAffinity(for: MediaItem(id: "tt-judge", type: .movie, title: "Judge Dredd"))
        let prompt = await provider.snapshotPrompt()

        #expect(prompt.contains("they marked it watched"))
        #expect(prompt.contains("their recorded rating was 8 out of 10"))
        #expect(prompt.contains("they are about 40% through it"))
        #expect(await provider.callCount == 1)
    }

    @Test("recommend uses cached result for the same request")
    func recommendCachesByContextSignature() async throws {
        let provider = RecommendationCallCounterProvider(
            kind: .openAI,
            recommendations: [
                AIMovieRecommendation(title: "Retry", year: 2009, reason: "cached", score: 0.9)
            ]
        )
        let manager = AIAssistantManager(
            providers: [.openAI: provider],
            database: nil,
            settings: nil,
            metadataProvider: nil
        )
        let request = AIAssistantRequest(
            prompt: "discover",
            maxResults: 5,
            compareMode: false,
            providers: []
        )
        let first = await manager.recommend(request: request)
        let second = await manager.recommend(request: request)

        #expect(first.mergedRecommendations == second.mergedRecommendations)
        #expect(await provider.callCount == 1)
    }

    @Test("recommend returns static fallback when no candidates are available")
    func recommendFallsBackWhenCandidatesMissing() async throws {
        let manager = AIAssistantManager(
            providers: [.openAI: MockAIProvider(kind: .openAI, recommendations: [])],
            database: nil,
            settings: nil,
            metadataProvider: nil
        )
        let result = await manager.recommend(
            request: AIAssistantRequest(prompt: "empty candidates", maxResults: 3, compareMode: false, providers: [])
        )

        #expect(result.usedFallback)
        #expect(result.mergedRecommendations.first?.title == "Try refreshing Discover")
    }

    @Test("recommend in non-compare mode uses the first requested provider")
    func recommendSingleProviderInNonCompareMode() async throws {
        let primary = RecommendationCallCounterProvider(
            kind: .anthropic,
            recommendations: [
                AIMovieRecommendation(title: "Anthropic First", year: 2026, reason: "primary", score: 0.8)
            ]
        )
        let secondary = RecommendationCallCounterProvider(
            kind: .openAI,
            recommendations: [
                AIMovieRecommendation(title: "OpenAI Second", year: 2026, reason: "secondary", score: 0.7)
            ]
        )
        let manager = AIAssistantManager(
            providers: [.openAI: secondary, .anthropic: primary],
            database: nil,
            settings: nil,
            metadataProvider: nil
        )

        let result = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "top picks",
                maxResults: 4,
                compareMode: false,
                providers: [.anthropic, .openAI]
            )
        )

        #expect(result.mergedRecommendations.first?.title == "Anthropic First")
        #expect(await primary.callCount == 1)
        #expect(await secondary.callCount == 0)
    }

    @Test("recommend compare mode merges overlapping recommendations with RRF scoring")
    func recommendMergesWithRRF() async throws {
        let openProvider = RecommendationCallCounterProvider(
            kind: .openAI,
            recommendations: [
                AIMovieRecommendation(title: "Open Only", year: 2025, reason: "open-0", score: 0.9),
                AIMovieRecommendation(title: "Shared", year: 2020, reason: "open-1", score: 0.8),
            ]
        )
        let anthropicProvider = RecommendationCallCounterProvider(
            kind: .anthropic,
            recommendations: [
                AIMovieRecommendation(title: "Shared", year: 2020, reason: "anth-0", score: 0.9),
                AIMovieRecommendation(title: "Anthropic Only", year: 2024, reason: "anth-1", score: 0.85),
            ]
        )
        let manager = AIAssistantManager(
            providers: [.openAI: openProvider, .anthropic: anthropicProvider],
            database: nil,
            settings: nil,
            metadataProvider: nil
        )

        let result = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "hybrid",
                maxResults: 5,
                compareMode: true,
                providers: [.openAI, .anthropic]
            )
        )

        #expect(result.usedFallback == false)
        #expect(result.mergedRecommendations.map { $0.title } == ["Shared", "Open Only", "Anthropic Only"])
        #expect(await openProvider.callCount == 1)
        #expect(await anthropicProvider.callCount == 1)
    }

    @Test("recommend enriches recommendations from database cache and metadata search")
    func recommendEnrichesWithDatabaseAndMetadata() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(
            MediaItem(
                id: "tt-cached",
                type: .movie,
                title: "Cached",
                year: 2015,
                posterPath: "/cached.jpg",
                tmdbId: 11
            )
        )
        let provider = MockAIProvider(
            kind: .openAI,
            recommendations: [
                AIMovieRecommendation(title: "Cached", reason: "in db", score: 0.9),
                AIMovieRecommendation(title: "Fresh", reason: "from search", score: 0.8),
            ]
        )
        let metadata = QueryAwareMetadataProvider(
            searchByQuery: [
                "Fresh": MetadataSearchResult(
                    items: [
                        MediaPreview(
                            id: "tmdb-fresh",
                            type: .movie,
                            title: "Fresh",
                            year: 2023,
                            posterPath: "/fresh.jpg",
                            imdbRating: 8.4,
                            tmdbId: 1234
                        )
                    ],
                    page: 1,
                    totalPages: 1,
                    totalResults: 1
                )
            ],
            keywordsByQuery: [:],
            movieGenres: [],
            seriesGenres: []
        )
        let manager = AIAssistantManager(
            providers: [.openAI: provider],
            database: db,
            settings: nil,
            metadataProvider: metadata
        )

        let result = await manager.recommend(
            request: AIAssistantRequest(prompt: "enrich", maxResults: 4, compareMode: false, providers: [.openAI])
        )
        let first = result.mergedRecommendations.first
        let second = result.mergedRecommendations.count > 1 ? result.mergedRecommendations[1] : nil

        #expect(first != nil)

        #expect(first?.mediaId == "tt-cached")
        #expect(first?.posterPath == "/cached.jpg")
        #expect(first?.year == 2015)
        #expect(second != nil)
        #expect(second?.mediaId == "tmdb-fresh")
        #expect(second?.posterPath == "/fresh.jpg")
        #expect(second?.year == 2023)
        #expect((try? await db.fetchMedia(id: "tmdb-fresh")) != nil)
    }

    @Test("recommend chooses metadata preview by matching year")
    func recommendPrefersMatchingYearFromMetadataPreview() async throws {
        let db = try makeTestDatabase()
        let provider = MockAIProvider(
            kind: .openAI,
            recommendations: [
                AIMovieRecommendation(title: "Year Match", year: 2027, reason: "has year", score: 0.9)
            ]
        )
        let metadata = QueryAwareMetadataProvider(
            searchByQuery: [
                "Year Match": MetadataSearchResult(
                    items: [
                        MediaPreview(
                            id: "tmdb-2026",
                            type: .series,
                            title: "Year Match Alt",
                            year: 2026,
                            posterPath: "/wrong-year.jpg",
                            imdbRating: 7.0,
                            tmdbId: 2026
                        ),
                        MediaPreview(
                            id: "tmdb-2027",
                            type: .series,
                            title: "Year Match",
                            year: 2027,
                            posterPath: "/correct-year.jpg",
                            imdbRating: 8.1,
                            tmdbId: 2027
                        )
                    ],
                    page: 1,
                    totalPages: 1,
                    totalResults: 2
                )
            ],
            keywordsByQuery: [:],
            movieGenres: [],
            seriesGenres: []
        )
        let manager = AIAssistantManager(
            providers: [.openAI: provider],
            database: db,
            settings: nil,
            metadataProvider: metadata
        )

        let result = await manager.recommend(
            request: AIAssistantRequest(prompt: "year", maxResults: 1, compareMode: false, providers: [.openAI])
        )
        let recommendation = result.mergedRecommendations.first

        #expect(recommendation != nil)
        #expect(recommendation?.mediaId == "tmdb-2027")
        #expect(recommendation?.year == 2027)
        #expect(recommendation?.posterPath == "/correct-year.jpg")
    }
}

@Suite("AIAssistantJSONParser Tests")
struct AIAssistantJSONParserTests {
    @Test("Parses a clean JSON object")
    func parsesCleanJSON() {
        let text = #"{"recommendations":[{"title":"Dune","year":2021,"reason":"Epic","score":0.9}]}"#
        let recs = AIAssistantJSONParser.parseRecommendations(from: text, maxResults: 5)
        #expect(recs.count == 1)
        #expect(recs.first?.title == "Dune")
        #expect(recs.first?.year == 2021)
    }

    @Test("Extracts JSON wrapped in markdown code fences")
    func parsesFencedJSON() {
        let text = """
        Here are my picks:
        ```json
        {"recommendations":[{"title":"Arrival","year":2016,"reason":"Smart","score":0.8}]}
        ```
        Hope that helps!
        """
        let recs = AIAssistantJSONParser.parseRecommendations(from: text, maxResults: 5)
        #expect(recs.count == 1)
        #expect(recs.first?.title == "Arrival")
    }

    @Test("Picks the first balanced object when multiple JSON objects are present")
    func parsesFirstOfMultipleObjects() {
        // The previous greedy first-to-last-brace regex would span both objects
        // and fail to decode. Balanced extraction must take only the first.
        let text = """
        {"recommendations":[{"title":"Interstellar","year":2014,"reason":"Scale","score":0.85}]}
        {"recommendations":[{"title":"Tenet","year":2020,"reason":"Time","score":0.7}]}
        """
        let recs = AIAssistantJSONParser.parseRecommendations(from: text, maxResults: 5)
        #expect(recs.count == 1)
        #expect(recs.first?.title == "Interstellar")
    }

    @Test("Braces inside string values do not break extraction")
    func parsesWithBracesInsideStrings() {
        let text = #"{"recommendations":[{"title":"The } Movie {","year":2024,"reason":"Has braces } in it","score":0.6}]}"#
        let recs = AIAssistantJSONParser.parseRecommendations(from: text, maxResults: 5)
        #expect(recs.count == 1)
        #expect(recs.first?.title == "The } Movie {")
    }

    @Test("Falls back to line parsing when no JSON object is present")
    func fallsBackToLineParsing() {
        let text = """
        1. Dune
        2. Arrival
        """
        let recs = AIAssistantJSONParser.parseRecommendations(from: text, maxResults: 5)
        #expect(recs.count == 2)
        #expect(recs[0].title == "Dune")
        #expect(recs[1].title == "Arrival")
    }
}

private struct MockAIProvider: AIAssistantProvider {
    let kind: AIProviderKind
    let recommendations: [AIMovieRecommendation]
    var shouldThrow = false

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        if shouldThrow {
            throw AIAssistantProviderError.apiError("failed")
        }
        return AIProviderRecommendationResult(
            model: "mock-model",
            recommendations: Array(recommendations.prefix(maxResults)),
            rawText: nil,
            usage: nil
        )
    }
}

private actor CapturingProvider: AIAssistantProvider {
    nonisolated let kind: AIProviderKind = .openAI
    private var candidates: [String] = []

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        candidates = candidateTitles
        return AIProviderRecommendationResult(
            model: "capturing-model",
            recommendations: [
                AIMovieRecommendation(
                    title: "Captured",
                    year: 2024,
                    reason: "capture",
                    score: 0.9
                )
            ],
            rawText: nil,
            usage: nil
        )
    }

    func snapshotCandidates() -> [String] {
        candidates
    }
}

private actor RecordingProvider: AIAssistantProvider {
    nonisolated let kind: AIProviderKind = .openAI
    private var calls: [[String]] = []

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        calls.append(candidateTitles)
        return AIProviderRecommendationResult(
            model: "recording-model",
            recommendations: [
                AIMovieRecommendation(
                    title: "Recorded",
                    year: 2025,
                    reason: "Recorded call",
                    score: 0.8
                )
            ],
            rawText: nil,
            usage: nil
        )
    }

    func snapshots() -> [[String]] {
        calls
    }
}

private struct UsageProvider: AIAssistantProvider {
    let kind: AIProviderKind = .openAI

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        AIProviderRecommendationResult(
            model: "gpt-4.1-mini",
            recommendations: [
                AIMovieRecommendation(title: "Usage", year: 2026, reason: "Usage", score: 0.9)
            ],
            rawText: nil,
            usage: AIUsageMetrics(
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
                estimatedCostUSD: 0.003
            )
        )
    }
}

private struct DiscoverPlanProvider: AIAssistantProvider {
    let kind: AIProviderKind
    let rawText: String

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        AIProviderRecommendationResult(
            model: "discover-plan-model",
            recommendations: [],
            rawText: rawText,
            usage: nil
        )
    }
}

private struct QueryAwareMetadataProvider: MetadataProvider {
    let searchByQuery: [String: MetadataSearchResult]
    let keywordsByQuery: [String: [TMDBKeyword]]
    let movieGenres: [Genre]
    let seriesGenres: [Genre]

    func search(query: String, type: MediaType?, page: Int) async throws -> MetadataSearchResult {
        searchByQuery[query] ?? MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }

    func getDetail(id: String, type: MediaType) async throws -> MediaItem {
        MediaItem(id: id, type: type, title: id)
    }

    func getTrending(type: MediaType, timeWindow: TrendingWindow, page: Int) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }

    func getCategory(_ category: MediaCategory, type: MediaType, page: Int) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }

    func discover(type: MediaType, filters: DiscoverFilters) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }

    func getGenres(type: MediaType) async throws -> [Genre] {
        switch type {
        case .movie:
            movieGenres
        case .series:
            seriesGenres
        }
    }

    func getSeasons(tmdbId: Int) async throws -> [Season] {
        []
    }

    func getEpisodes(tmdbId: Int, season: Int) async throws -> [Episode] {
        []
    }

    func getExternalIds(tmdbId: Int, type: MediaType) async throws -> ExternalIds {
        ExternalIds(imdbId: nil, tvdbId: nil)
    }

    func getCast(tmdbId: Int, type: MediaType) async throws -> [CastMember] {
        []
    }

    func getRecommendations(tmdbId: Int, type: MediaType) async throws -> [MediaPreview] {
        []
    }

    func getPerson(personId: Int) async throws -> Person {
        Person(id: personId, name: "Person \(personId)")
    }

    func getPersonCredits(personId: Int) async throws -> [MediaPreview] {
        []
    }

    func searchKeywords(query: String) async throws -> [TMDBKeyword] {
        keywordsByQuery[query] ?? []
    }
}

private actor RecommendationCallCounterProvider: AIAssistantProvider {
    let kind: AIProviderKind
    let recommendations: [AIMovieRecommendation]

    private(set) var callCount = 0

    init(kind: AIProviderKind, recommendations: [AIMovieRecommendation]) {
        self.kind = kind
        self.recommendations = recommendations
    }

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        callCount += 1
        return AIProviderRecommendationResult(
            model: "recommendation-provider",
            recommendations: Array(recommendations.prefix(maxResults)),
            rawText: nil,
            usage: AIUsageMetrics(
                inputTokens: 30,
                outputTokens: 40,
                totalTokens: 70,
                estimatedCostUSD: 0.00012
            )
        )
    }
}

private actor CachedAffinityProvider: AIAssistantProvider {
    let kind: AIProviderKind
    let rawText: String
    private(set) var callCount = 0

    init(kind: AIProviderKind, rawText: String) {
        self.kind = kind
        self.rawText = rawText
    }

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        callCount += 1
        return AIProviderRecommendationResult(
            model: "affinity-provider",
            recommendations: [],
            rawText: rawText,
            usage: nil
        )
    }
}

private actor CapturingPromptProvider: AIAssistantProvider {
    let kind: AIProviderKind
    let rawText: String
    private var snapshot: String = ""
    private(set) var callCount = 0

    init(kind: AIProviderKind, rawText: String) {
        self.kind = kind
        self.rawText = rawText
    }

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        snapshot = prompt
        callCount += 1
        return AIProviderRecommendationResult(
            model: "capturing-prompt-provider",
            recommendations: [],
            rawText: rawText,
            usage: nil
        )
    }

    func snapshotPrompt() -> String {
        snapshot
    }
}
