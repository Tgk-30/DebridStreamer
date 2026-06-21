import Foundation
import Observation

@MainActor
@Observable
final class DiscoverAICurationStore {
    var recommendations: [AIMovieRecommendation] = []
    var isLoading = false
    var lastError: String?
    private(set) var hasLoaded = false

    func reset() {
        recommendations = []
        isLoading = false
        lastError = nil
        hasLoaded = false
    }

    func preloadIfNeeded(service: DiscoverAICurationService?) async {
        guard !hasLoaded else { return }
        await load(service: service, forceRefresh: false)
    }

    func load(service: DiscoverAICurationService?, forceRefresh: Bool) async {
        guard !isLoading else { return }
        guard let service else { return }

        isLoading = true
        defer { isLoading = false }

        if !forceRefresh {
            let cached = await service.cachedRecommendations()
            if !cached.isEmpty {
                recommendations = cached
                hasLoaded = true
            }
        }

        guard await service.shouldGenerateOnLaunch() else {
            hasLoaded = true
            return
        }

        let generated = await service.generateRecommendations(forceRefresh: forceRefresh)
        if generated.isEmpty {
            if recommendations.isEmpty {
                lastError = "AI curated recommendations are currently unavailable."
            }
            hasLoaded = true
            return
        }

        recommendations = generated
        lastError = nil
        hasLoaded = true
    }
}

