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
    var assistantDraftPrompt = ""
    var selectedLibraryFolderId: String?
    var activePlayerSession: PlayerSessionRequest?
    var activePlayerIsFullscreen = false
    private let secretStore: any SecretStore
    let discoverStore = DiscoverCatalogStore()
    let discoverAICurationStore = DiscoverAICurationStore()

    // Services (lazy-initialized)
    private(set) var databaseManager: DatabaseManager?
    private(set) var metadataService: TMDBService?
    private(set) var settingsManager: SettingsManager?
    private(set) var debridManager: DebridManager?
    private(set) var indexerManager: IndexerManager?
    private(set) var aiAssistantManager: AIAssistantManager?
    private(set) var discoverAICurationService: DiscoverAICurationService?
    private var playerWindowController: PlayerWindowController?

    init(secretStore: any SecretStore = KeychainSecretStore()) {
        self.secretStore = secretStore
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
        let dbManager = try DatabaseManager()
        self.databaseManager = dbManager

        let settings = SettingsManager(database: dbManager, secretStore: secretStore)
        self.settingsManager = settings

        let tmdbKey = try await settings.getValue(forKey: SettingsKeys.tmdbApiKey) ?? ""
        if !tmdbKey.isEmpty {
            self.metadataService = TMDBService(apiKey: tmdbKey)
        }

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
        if !apiKey.isEmpty {
            self.metadataService = TMDBService(apiKey: apiKey)
        } else {
            self.metadataService = nil
        }

        Task { [weak self] in
            guard let self else { return }
            await self.preloadDiscoverCatalog(forceRefresh: true)
            await self.reloadAIAssistantManager()
            await self.preloadDiscoverAICuration(forceRefresh: true)
        }
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
            defaultModel: "gpt-4o-mini"
        )
        let anthropicModel = resolveModelID(
            preset: try? await settings.getValue(forKey: SettingsKeys.anthropicModelPreset),
            custom: try? await settings.getValue(forKey: SettingsKeys.anthropicModelCustom),
            defaultModel: "claude-3-5-haiku-latest"
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

        aiAssistantManager = AIAssistantManager(
            providers: providers,
            database: databaseManager,
            metadataProvider: metadataService
        )
        discoverAICurationService = DiscoverAICurationService(
            assistantManager: aiAssistantManager,
            database: databaseManager,
            settings: settingsManager
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
}
