import Foundation
import SwiftUI
import AppKit

/// Central application state observable by all views.
@Observable
@MainActor
final class AppState {
    var selectedSidebarItem: SidebarItem = .discover
    var selectedSettingsTab: SettingsTab = .general
    var isLoading = false
    var errorMessage: String?
    /// A query handed off from the global top-right search field; the Search
    /// screen consumes and clears it. nil when there's nothing pending.
    var pendingSearchQuery: String?
    var assistantDraftPrompt = ""
    var selectedLibraryFolderId: String?
    var activePlayerSession: PlayerSessionRequest?
    var activePlayerIsFullscreen = false
    let appLaunchDate = Date()
    private let secretStore: any SecretStore
    let discoverStore = DiscoverCatalogStore()
    let discoverAICurationStore = DiscoverAICurationStore()

    // Services (lazy-initialized)
    private(set) var databaseManager: DatabaseManager?
    private(set) var metadataService: TMDBService?
    private(set) var omdbService: OMDBService?
    private(set) var settingsManager: SettingsManager?
    private(set) var debridManager: DebridManager?
    private(set) var indexerManager: IndexerManager?
    private(set) var aiAssistantManager: AIAssistantManager?
    private(set) var discoverAICurationService: DiscoverAICurationService?
    /// Synchronous gate for the AI mood discovery UI: true when the last
    /// `reloadAIAssistantManager` assembled at least one provider. Mirrors the
    /// actor-isolated `aiAssistantManager.hasAnyProvider` without an await.
    private(set) var aiAssistantHasProvider = false
    private(set) var userFeedbackService: UserFeedbackService?
    /// Coordinates Trakt connection state, token refresh, watchlist sync, and
    /// best-effort scrobbling. nil until `initialize()` runs.
    private(set) var traktCoordinator: TraktCoordinator?
    private var playerWindowController: PlayerWindowController?

    init(
        secretStore: any SecretStore = KeychainSecretStore(),
        databaseManager: DatabaseManager? = nil
    ) {
        self.secretStore = secretStore
        self.databaseManager = databaseManager
    }

    func openPlayer(_ request: PlayerSessionRequest) {
        closePlayer()
        activePlayerSession = request
        activePlayerIsFullscreen = false

        let controller = PlayerWindowController(appState: self, request: request)
        playerWindowController = controller
        controller.show()
    }

    func closePlayer() {
        playerWindowController?.close()
        playerWindowController = nil
        activePlayerSession = nil
        activePlayerIsFullscreen = false
    }

    func playerWindowDidClose(requestID: UUID) {
        guard activePlayerSession?.id == requestID else { return }
        activePlayerSession = nil
        playerWindowController = nil
        activePlayerIsFullscreen = false
    }

    func playerWindowDidChangeFullscreen(requestID: UUID, isFullscreen: Bool) {
        guard activePlayerSession?.id == requestID else { return }
        activePlayerIsFullscreen = isFullscreen
    }

    func initialize() async throws {
        let dbManager = try databaseManager ?? DatabaseManager()
        self.databaseManager = dbManager
        try await dbManager.ensureDefaultBehaviorFolders()

        let settings = SettingsManager(database: dbManager, secretStore: secretStore)
        self.settingsManager = settings
        self.traktCoordinator = TraktCoordinator(settings: settings)

        // One-time eager sweep of any lingering plaintext secrets into the keychain.
        // Best-effort: a failure must not abort the rest of bootstrap (the lazy
        // per-read migration in SettingsManager.getValue still covers these keys).
        do {
            try await settings.migrateLegacySecretsIfNeeded()
        } catch {
            errorMessage = "Failed to migrate legacy secrets: \(error.localizedDescription)"
        }

        let tmdbKey = try await settings.getValue(forKey: SettingsKeys.tmdbApiKey) ?? ""
        if !tmdbKey.isEmpty {
            self.metadataService = TMDBService(apiKey: tmdbKey)
        }

        let omdbKey = (try await settings.getOMDBApiKey() ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !omdbKey.isEmpty {
            self.omdbService = OMDBService(apiKey: omdbKey)
        }
        self.userFeedbackService = UserFeedbackService(
            database: dbManager,
            metadataService: metadataService
        )

        // Initialize indexer manager from saved configs (falls back to built-ins)
        let indexerConfigs = try await dbManager.fetchAllIndexerConfigs()
        self.indexerManager = IndexerManager(configs: indexerConfigs)

        // Initialize debrid manager from saved configs
        let debrid = DebridManager(secretStore: secretStore)
        let configs = try await migratedDebridConfigs(from: dbManager)
        await debrid.configure(configs: configs)
        self.debridManager = debrid

        await reloadAIAssistantManager()
        await preloadDiscoverCatalog(forceRefresh: true)
        await preloadDiscoverAICuration(forceRefresh: false)
    }

    func updateTMDBService(apiKey: String) {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            self.metadataService = TMDBService(apiKey: trimmed)
        } else {
            self.metadataService = nil
        }
        self.userFeedbackService = UserFeedbackService(
            database: databaseManager,
            metadataService: metadataService
        )

        Task { [weak self] in
            guard let self else { return }
            await self.preloadDiscoverCatalog(forceRefresh: true)
            await self.reloadAIAssistantManager()
            await self.preloadDiscoverAICuration(forceRefresh: true)
        }
    }

    /// Rebuild (or tear down) the OMDB ratings client when the saved key changes.
    func updateOMDBService(apiKey: String) {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        self.omdbService = trimmed.isEmpty ? nil : OMDBService(apiKey: trimmed)
    }

    func openSettings(tab: SettingsTab) {
        selectedSettingsTab = tab
        selectedSidebarItem = .settings
    }

    func shouldShowPersonalizationPrompt() async -> Bool {
        guard metadataService != nil else { return false }
        guard let settings = settingsManager else { return false }
        guard let database = databaseManager else { return false }

        let alreadyShown = (try? await settings.wasOnboardingTastePromptShown()) == true
        if alreadyShown { return false }

        let personalizationEnabled = (try? await settings.isPersonalizationEnabled()) == true
        if personalizationEnabled { return false }

        let hasProfile = (try? await database.fetchUserTasteProfile()) != nil
        return !hasProfile
    }

    func markPersonalizationPromptShown() async {
        guard let settings = settingsManager else { return }
        try? await settings.setOnboardingTastePromptShown(true)
    }

    func reloadAIAssistantManager() async {
        guard let settings = settingsManager else { return }

        var providers: [AIProviderKind: any AIAssistantProvider] = [:]
        let openAIModel = resolveModelID(
            preset: try? await settings.getValue(forKey: SettingsKeys.openAIModelPreset),
            custom: try? await settings.getValue(forKey: SettingsKeys.openAIModelCustom),
            defaultModel: "gpt-4.1-mini"
        )
        let anthropicModel = resolveModelID(
            preset: try? await settings.getValue(forKey: SettingsKeys.anthropicModelPreset),
            custom: try? await settings.getValue(forKey: SettingsKeys.anthropicModelCustom),
            defaultModel: "claude-sonnet-4-6"
        )

        if let openAIKey = try? await settings.getValue(forKey: SettingsKeys.openAIApiKey),
           !openAIKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            providers[.openAI] = OpenAIProvider(apiKey: openAIKey, model: openAIModel)
        }

        if let anthropicKey = try? await settings.getValue(forKey: SettingsKeys.anthropicApiKey),
           !anthropicKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            providers[.anthropic] = AnthropicProvider(apiKey: anthropicKey, model: anthropicModel)
        }

        let storedOllama = try? await settings.getValue(forKey: SettingsKeys.ollamaEndpoint)
        let ollamaEndpoint = (storedOllama ?? "http://localhost:11434/api/chat")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let ollamaURL = URL(string: ollamaEndpoint) {
            providers[.ollama] = OllamaProvider(endpoint: ollamaURL)
        }

        aiAssistantHasProvider = !providers.isEmpty
        aiAssistantManager = AIAssistantManager(
            providers: providers,
            database: databaseManager,
            settings: settingsManager,
            metadataProvider: metadataService
        )
        discoverAICurationService = DiscoverAICurationService(
            assistantManager: aiAssistantManager,
            database: databaseManager,
            settings: settingsManager,
            metadataProvider: metadataService
        )
    }

    func preloadDiscoverCatalog(forceRefresh: Bool = false) async {
        if forceRefresh {
            await discoverStore.load(
                provider: metadataService,
                database: databaseManager,
                forceRefresh: true
            ) { [weak self] message in
                self?.errorMessage = message
            }
            return
        }

        await discoverStore.preloadIfNeeded(
            provider: metadataService,
            database: databaseManager
        ) { [weak self] message in
            self?.errorMessage = message
        }
    }

    func preloadDiscoverAICuration(forceRefresh: Bool = false) async {
        if forceRefresh {
            await discoverAICurationStore.load(service: discoverAICurationService, forceRefresh: true)
            return
        }
        await discoverAICurationStore.preloadIfNeeded(service: discoverAICurationService)
    }

    /// Reload debrid configs (call after saving new tokens in settings).
    func reloadDebridServices() async {
        guard let db = databaseManager, let debrid = debridManager else { return }
        do {
            let configs = try await migratedDebridConfigs(from: db)
            await debrid.configure(configs: configs)
        } catch {
            errorMessage = "Failed to reload debrid services: \(error.localizedDescription)"
        }
    }

    func reloadIndexers() async {
        guard let db = databaseManager, let indexers = indexerManager else { return }
        do {
            let configs = try await db.fetchAllIndexerConfigs()
            await indexers.configure(with: configs)
        } catch {
            errorMessage = "Failed to reload indexers: \(error.localizedDescription)"
        }
    }

    /// Fire-and-forget Trakt scrobble keyed off the current playback context.
    /// `mediaId` is the player's media id (IMDb `tt…` or a synthesized id);
    /// non-IMDb ids and an unconnected Trakt are silently ignored. Never blocks
    /// or fails playback. `episodeId` follows the `\(showId)-s\(season)e\(episode)`
    /// shape produced by DetailView; season/episode are parsed back out for series.
    func scrobbleTrakt(
        mediaId: String,
        episodeId: String?,
        progressPercent: Double,
        action: TraktSyncService.ScrobbleAction
    ) {
        guard let coordinator = traktCoordinator else { return }
        let (season, episode) = Self.parseSeasonEpisode(from: episodeId)
        Task.detached {
            await coordinator.scrobble(
                imdbID: mediaId,
                season: season,
                episode: episode,
                progressPercent: progressPercent,
                action: action
            )
        }
    }

    /// Parses `s{season}e{episode}` out of an episode id like `tt123-s2e5`.
    static func parseSeasonEpisode(from episodeId: String?) -> (season: Int?, episode: Int?) {
        guard let episodeId else { return (nil, nil) }
        guard let match = episodeId.range(of: "s(\\d+)e(\\d+)", options: [.regularExpression, .caseInsensitive]) else {
            return (nil, nil)
        }
        let token = String(episodeId[match])
        let numbers = token.lowercased()
            .replacingOccurrences(of: "s", with: " ")
            .replacingOccurrences(of: "e", with: " ")
            .split(separator: " ")
            .compactMap { Int($0) }
        guard numbers.count == 2 else { return (nil, nil) }
        return (numbers[0], numbers[1])
    }

    /// Imports the user's Trakt movie watchlist into the local watchlist list.
    /// Returns the number of newly-added entries. Existing entries are skipped.
    /// Throws on a hard failure (not connected, network/auth error) so the caller
    /// can surface a message.
    @discardableResult
    func importTraktWatchlist() async throws -> Int {
        guard let coordinator = traktCoordinator, let db = databaseManager else {
            throw TraktSyncError.invalidResponse
        }
        let items = try await coordinator.fetchWatchlist()
        let folderId = try await db.fetchSystemLibraryFolderID(listType: .watchlist)

        var added = 0
        for item in items {
            let mediaId = item.imdbID
            let exists = (try? await db.isInLibrary(mediaId: mediaId, folderId: folderId)) ?? false
            if exists { continue }

            if (try? await db.fetchMedia(id: mediaId)) == nil {
                let media = MediaItem(
                    id: mediaId,
                    type: .movie,
                    title: item.title,
                    year: item.year,
                    lastFetched: Date()
                )
                try? await db.saveMedia(media)
            }

            let entry = UserLibraryEntry(
                id: "\(mediaId)-\(folderId)",
                mediaId: mediaId,
                folderId: folderId,
                listType: .watchlist,
                addedAt: Date()
            )
            try await db.addToLibrary(entry)
            added += 1
        }
        return added
    }

    private func migratedDebridConfigs(from database: DatabaseManager) async throws -> [DebridConfig] {
        let configs = try await database.fetchDebridConfigs()
        var migratedConfigs: [DebridConfig] = []

        for config in configs {
            if SecretReference.decode(config.apiToken) != nil {
                migratedConfigs.append(config)
                continue
            }

            let secretKey = SecretKey.debridToken(service: config.service)
            try await secretStore.setSecret(config.apiToken, for: secretKey)

            var migrated = config
            migrated.apiToken = SecretReference.encode(key: secretKey)
            try await database.saveDebridConfig(migrated)
            migratedConfigs.append(migrated)
        }

        return migratedConfigs
    }

    private func resolveModelID(preset: String?, custom: String?, defaultModel: String) -> String {
        let presetValue = preset?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let customValue = custom?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        if presetValue == "custom" {
            return customValue.isEmpty ? defaultModel : customValue
        }
        if !presetValue.isEmpty {
            return presetValue
        }
        if !customValue.isEmpty {
            return customValue
        }
        return defaultModel
    }
}

enum SidebarItem: String, CaseIterable, Identifiable {
    case discover = "Discover"
    case search = "Search"
    case library = "Library"
    case watchlist = "Watchlist"
    case history = "History"
    case assistant = "AI Assistant"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .discover: return "sparkles.tv"
        case .search: return "magnifyingglass"
        case .library: return "books.vertical"
        case .watchlist: return "bookmark"
        case .history: return "clock"
        case .assistant: return "wand.and.stars"
        case .settings: return "gear"
        }
    }

    /// Short label for the slim nav rail (where "AI Assistant" won't fit).
    var shortLabel: String {
        switch self {
        case .assistant: return "Assistant"
        default: return rawValue
        }
    }

    /// The primary destinations shown in the nav rail. Search lives in the
    /// top-right global field; Settings is pinned separately at the rail bottom.
    static let railPrimary: [SidebarItem] = [.discover, .library, .watchlist, .history, .assistant]
}
