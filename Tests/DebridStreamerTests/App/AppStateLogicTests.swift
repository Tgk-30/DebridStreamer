import Testing
import Foundation
import GRDB
@testable import DebridStreamer

/// Deterministic, pure-logic coverage for `AppState`'s player-session lifecycle.
///
/// `resolveModelID(preset:custom:defaultModel:)` is `private` on `AppState` and is
/// only reachable through `reloadAIAssistantManager()`, which in turn requires a
/// fully-bootstrapped `settingsManager` (i.e. `initialize()` and its DB/network
/// side effects). That is not a "smallest reachable path", so per the area brief
/// this suite instead exhaustively exercises the request-ID matching in
/// `openPlayer` / `closePlayer` / `playerWindowDidClose(requestID:)`, focusing on
/// scenarios distinct from `AppStatePlayerWindowTests`.
@Suite("AppState Logic Tests")
@MainActor
struct AppStateLogicTests {

    @Test("Fresh AppState has no active player session or fullscreen state")
    func initialPlayerStateIsEmpty() {
        let appState = AppState(secretStore: InMemorySecretStore())
        #expect(appState.activePlayerSession == nil)
        #expect(appState.activePlayerIsFullscreen == false)
    }

    @Test("closePlayer is idempotent and clears state even when nothing is open")
    func closePlayerWithoutOpenIsSafe() {
        let appState = AppState(secretStore: InMemorySecretStore())

        // Closing with no active session must not crash and must leave state clear.
        appState.closePlayer()
        #expect(appState.activePlayerSession == nil)
        #expect(appState.activePlayerIsFullscreen == false)

        // Open then close, then close again - second close is a no-op.
        let request = Self.makeRequest()
        appState.openPlayer(request)
        #expect(appState.activePlayerSession?.id == request.id)

        appState.closePlayer()
        #expect(appState.activePlayerSession == nil)
        appState.closePlayer()
        #expect(appState.activePlayerSession == nil)
    }

    @Test("openPlayer resets fullscreen state inherited from a prior session")
    func openPlayerResetsFullscreen() {
        let appState = AppState(secretStore: InMemorySecretStore())
        let first = Self.makeRequest(title: "First")
        appState.openPlayer(first)

        // Drive the first session into fullscreen.
        appState.playerWindowDidChangeFullscreen(requestID: first.id, isFullscreen: true)
        #expect(appState.activePlayerIsFullscreen == true)

        // Opening a new session must start non-fullscreen and adopt the new request.
        let second = Self.makeRequest(title: "Second")
        appState.openPlayer(second)
        #expect(appState.activePlayerSession?.id == second.id)
        #expect(appState.activePlayerIsFullscreen == false)
    }

    @Test("playerWindowDidClose for a superseded request does not clear the new session")
    func staleCloseAfterReplaceIsIgnored() {
        let appState = AppState(secretStore: InMemorySecretStore())
        let old = Self.makeRequest(title: "Old")
        let new = Self.makeRequest(title: "New")

        appState.openPlayer(old)
        appState.openPlayer(new) // replaces `old`; `new` is now active
        #expect(appState.activePlayerSession?.id == new.id)

        // A late close callback from the OLD window must not tear down the NEW session.
        appState.playerWindowDidClose(requestID: old.id)
        #expect(appState.activePlayerSession?.id == new.id)

        // The matching close for the active session does clear it.
        appState.playerWindowDidClose(requestID: new.id)
        #expect(appState.activePlayerSession == nil)
    }

    @Test("preload calls with missing dependencies are no-ops")
    func preloadWithoutDependenciesIsSafe() async {
        let appState = AppState(secretStore: InMemorySecretStore())

        await appState.preloadDiscoverCatalog(forceRefresh: false)
        await appState.preloadDiscoverCatalog(forceRefresh: true)
        #expect(appState.discoverStore.isLoaded == false)

        await appState.preloadDiscoverAICuration(forceRefresh: false)
        await appState.preloadDiscoverAICuration(forceRefresh: true)
        #expect(appState.discoverAICurationStore.hasLoaded == false)
    }

    @Test("reloadIndexers and reloadDebridServices are safe before initialization")
    func reloadHelpersAreNoOpsBeforeDependenciesReady() async {
        let appState = AppState(secretStore: InMemorySecretStore())

        await appState.reloadIndexers()
        await appState.reloadDebridServices()
        #expect(appState.errorMessage == nil)
    }

    @Test("scrobbleTrakt without Trakt coordinator keeps operation fire-and-forget")
    func scrobbleWithoutCoordinatorIsNoop() {
        let appState = AppState(secretStore: InMemorySecretStore())

        appState.scrobbleTrakt(
            mediaId: "tt1234567",
            episodeId: "tt1234567-s1e2",
            progressPercent: 45,
            action: .start
        )

        #expect(appState.errorMessage == nil)
    }

    @Test("importTraktWatchlist without coordinator throws invalid response")
    func importTraktWatchlistWithoutCoordinatorThrows() async {
        let appState = AppState(secretStore: InMemorySecretStore())

        do {
            _ = try await appState.importTraktWatchlist()
            Issue.record("Expected importTraktWatchlist to throw")
        } catch let error as TraktSyncError {
            #expect(error == .invalidResponse)
        } catch {
            Issue.record("Unexpected error type: \(error)")
        }
    }

    @Test("Fullscreen change for a non-active request is ignored")
    func fullscreenChangeForStaleRequestIsIgnored() {
        let appState = AppState(secretStore: InMemorySecretStore())
        let active = Self.makeRequest(title: "Active")
        let stale = Self.makeRequest(title: "Stale")

        appState.openPlayer(active)
        #expect(appState.activePlayerIsFullscreen == false)

        // A fullscreen toggle keyed to a different (stale) request must be dropped.
        appState.playerWindowDidChangeFullscreen(requestID: stale.id, isFullscreen: true)
        #expect(appState.activePlayerIsFullscreen == false)

        // The matching request can toggle fullscreen on and back off.
        appState.playerWindowDidChangeFullscreen(requestID: active.id, isFullscreen: true)
        #expect(appState.activePlayerIsFullscreen == true)
        appState.playerWindowDidChangeFullscreen(requestID: active.id, isFullscreen: false)
        #expect(appState.activePlayerIsFullscreen == false)
    }

    @Test("playerWindowDidClose with a random request ID never clears an active session")
    func randomCloseIDLeavesSessionIntact() {
        let appState = AppState(secretStore: InMemorySecretStore())
        let request = Self.makeRequest()
        appState.openPlayer(request)

        for _ in 0..<5 {
            appState.playerWindowDidClose(requestID: UUID())
            #expect(appState.activePlayerSession?.id == request.id)
        }
    }

    @Test("openSettings selects settings tab and switches sidebar")
    func openSettingsSwitchesSidebar() {
        let appState = AppState(secretStore: InMemorySecretStore())

        #expect(appState.selectedSidebarItem == .discover)
        #expect(appState.selectedSettingsTab == .general)

        appState.openSettings(tab: .player)

        #expect(appState.selectedSidebarItem == .settings)
        #expect(appState.selectedSettingsTab == .player)
    }

    @Test("parseSeasonEpisode handles valid season and episode tokens")
    func parseSeasonEpisodeFromEpisodeID() {
        #expect(AppState.parseSeasonEpisode(from: "tt1234567-s2e9") == (2, 9))
        #expect(AppState.parseSeasonEpisode(from: "tt123-s02E10") == (2, 10))
        #expect(AppState.parseSeasonEpisode(from: nil) == (nil, nil))
    }

    @Test("parseSeasonEpisode returns nil for malformed values")
    func parseSeasonEpisodeRejectsInvalidInputs() {
        #expect(AppState.parseSeasonEpisode(from: "tt1234567") == (nil, nil))
        #expect(AppState.parseSeasonEpisode(from: "s2e") == (nil, nil))
        #expect(AppState.parseSeasonEpisode(from: "episode-se2e5") == (nil, nil))
    }

    @Test("updateTMDBService updates metadata service when non-empty and clears it when empty")
    func updateTMDBServiceRebuildsState() {
        let appState = AppState(secretStore: InMemorySecretStore())
        appState.updateTMDBService(apiKey: "my-key")
        #expect(appState.metadataService != nil)

        appState.updateTMDBService(apiKey: "   ")
        #expect(appState.metadataService == nil)
    }

    @Test("updateOMDBService trims whitespace and clears on empty")
    func updateOMDBServiceTrimsKey() {
        let appState = AppState(secretStore: InMemorySecretStore())
        appState.updateOMDBService(apiKey: "  xyz  ")
        #expect(appState.omdbService != nil)

        appState.updateOMDBService(apiKey: "   ")
        #expect(appState.omdbService == nil)
    }

    @Test("shouldShowPersonalizationPrompt is false before initialization")
    func shouldShowPersonalizationPromptBeforeDependenciesReady() async {
        let appState = AppState(secretStore: InMemorySecretStore())
        #expect(await appState.shouldShowPersonalizationPrompt() == false)
    }

    @Test("markPersonalizationPromptShown is a no-op when settings manager is unavailable")
    func markPromptShownWithoutSettingsManagerNoop() async {
        let appState = AppState(secretStore: InMemorySecretStore())
        await appState.markPersonalizationPromptShown()

        #expect(await appState.shouldShowPersonalizationPrompt() == false)
    }

    @Test("initialize builds core dependencies and configures bootstrap defaults")
    func initializeBuildsCoreDependencies() async throws {
        let appState = try Self.makeIsolatedAppState()

        // Run with a clean in-memory secret store so no secret values are injected
        // from the host environment during migration.
        try await appState.initialize()

        #expect(appState.databaseManager != nil)
        #expect(appState.settingsManager != nil)
        #expect(appState.debridManager != nil)
        #expect(appState.indexerManager != nil)
        #expect(appState.userFeedbackService != nil)
        #expect(appState.traktCoordinator != nil)
        #expect(appState.aiAssistantManager != nil)
        #expect(appState.discoverAICurationService != nil)

        // Without explicit keys, Ollama endpoint defaults still create a provider.
        #expect(appState.aiAssistantHasProvider == true)
        #expect(await appState.aiAssistantManager?.hasAnyProvider == true)
        #expect(await appState.aiAssistantManager?.availableProviders == [.ollama])

        // Initialization uses force refresh for discover data and guarded metadata-aware
        // preloading for curated AI recommendations.
        #expect(appState.discoverStore.isLoaded == false)
        #expect(appState.discoverAICurationStore.hasLoaded == true)
        #expect(appState.discoverAICurationStore.recommendations.isEmpty)
    }

    @Test("reloadAIAssistantManager respects saved AI settings")
    func reloadAIAssistantManagerUsesModelSettings() async throws {
        let appState = try Self.makeIsolatedAppState()
        try await appState.initialize()

        let settings = try #require(appState.settingsManager)

        // Force deterministic input to cover the resolveModelID branches.
        try await settings.setValue(nil, forKey: SettingsKeys.openAIApiKey)
        try await settings.setValue(nil, forKey: SettingsKeys.anthropicApiKey)
        try await settings.setValue("   ", forKey: SettingsKeys.ollamaEndpoint)

        try await settings.setValue("  test-openai-key  ", forKey: SettingsKeys.openAIApiKey)
        try await settings.setValue("custom", forKey: SettingsKeys.openAIModelPreset)
        try await settings.setValue("  gpt-4.1-mini  ", forKey: SettingsKeys.openAIModelCustom)

        try await settings.setValue("  test-anthropic-key  ", forKey: SettingsKeys.anthropicApiKey)
        try await settings.setValue(" ", forKey: SettingsKeys.anthropicModelPreset)
        try await settings.setValue("  claude-3-7-sonnet  ", forKey: SettingsKeys.anthropicModelCustom)

        try await settings.setValue("http://localhost:11434/api/chat", forKey: SettingsKeys.ollamaEndpoint)

        await appState.reloadAIAssistantManager()

        #expect(appState.aiAssistantHasProvider == true)
        #expect(await appState.aiAssistantManager?.hasAnyProvider == true)
        #expect(await appState.aiAssistantManager?.availableProviders == [.openAI, .anthropic, .ollama])
    }

    @Test("markPersonalizationPromptShown writes settings when settings manager is ready")
    func markPromptShownWritesSettings() async throws {
        let appState = try Self.makeIsolatedAppState()
        try await appState.initialize()

        let settings = try #require(appState.settingsManager)

        await appState.markPersonalizationPromptShown()
        let shown = try await settings.wasOnboardingTastePromptShown()
        #expect(shown == true)
    }

    @Test("shouldShowPersonalizationPrompt honors onboarding and profile state")
    func shouldShowPersonalizationPromptRespectsSavedState() async throws {
        let appState = try Self.makeIsolatedAppState()
        try await appState.initialize()

        appState.updateTMDBService(apiKey: "api-key")

        let settings = try #require(appState.settingsManager)
        let db = try #require(appState.databaseManager)

        #expect(await appState.shouldShowPersonalizationPrompt() == true)

        try await settings.setOnboardingTastePromptShown(true)
        #expect(await appState.shouldShowPersonalizationPrompt() == false)

        try await settings.setOnboardingTastePromptShown(false)
        try await settings.setPersonalizationEnabled(true)
        #expect(await appState.shouldShowPersonalizationPrompt() == false)

        try await settings.setPersonalizationEnabled(false)
        let profile = UserTasteProfile(
            eventCount: 1,
            updatedAt: Date()
        )
        try await db.saveUserTasteProfile(profile)
        #expect(await appState.shouldShowPersonalizationPrompt() == false)
    }

    @Test("initialize picks up persisted provider keys from settings")
    func initializeLoadsPersistedServiceSettings() async throws {
        let secretStore = InMemorySecretStore()
        let appState = try Self.makeIsolatedAppState(secretStore: secretStore)
        let dbManager = try #require(appState.databaseManager)
        let bootstrapSettings = SettingsManager(database: dbManager, secretStore: secretStore)
        try await bootstrapSettings.setValue("tmdb-token", forKey: SettingsKeys.tmdbApiKey)
        try await bootstrapSettings.setValue("omdb-token", forKey: SettingsKeys.omdbApiKey)

        try await appState.initialize()

        #expect(appState.metadataService != nil)
        #expect(appState.omdbService != nil)
        #expect(appState.aiAssistantHasProvider == true)
    }

    @Test("Sidebar items expose deterministic identifiers and labels")
    func sidebarItemsExposeIdentifiers() {
        let rail = SidebarItem.railPrimary
        #expect(rail == [.discover, .library, .watchlist, .history, .assistant])

        #expect(SidebarItem.discover.id == "Discover")
        #expect(SidebarItem.assistant.shortLabel == "Assistant")
        #expect(SidebarItem.settings.shortLabel == "Settings")
        #expect(SidebarItem.settings.icon == "gear")
    }

    // MARK: - Helpers

    private static func makeRequest(title: String = "Movie") -> PlayerSessionRequest {
        PlayerSessionRequest(
            stream: makeStream("https://cdn.example.com/\(title).mkv"),
            mediaTitle: title,
            mediaId: "tt-\(title)",
            episodeId: nil
        )
    }

    private static func makeStream(_ url: String) -> StreamInfo {
        StreamInfo(
            streamURL: url,
            quality: .hd1080p,
            codec: .h264,
            audio: .aac,
            source: .webDL,
            sizeBytes: 1_000_000_000,
            fileName: "Movie.1080p",
            debridService: "Real-Debrid"
        )
    }

    private static func makeIsolatedAppState(secretStore: InMemorySecretStore = InMemorySecretStore()) throws -> AppState {
        let dbDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("DebridStreamerTests", isDirectory: true)
        try FileManager.default.createDirectory(
            at: dbDirectory,
            withIntermediateDirectories: true
        )
        let dbPath = dbDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("sqlite")
        let dbPool = try DatabasePool(path: dbPath.path)
        let dbManager = try DatabaseManager(dbPool: dbPool)
        return AppState(
            secretStore: secretStore,
            databaseManager: dbManager
        )
    }
}
