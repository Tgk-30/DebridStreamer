import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    private static let customModelPreset = "custom"
    private static let defaultOpenAIModelPresets = [
        "gpt-4o-mini",
        "gpt-4.1-mini",
        "gpt-4.1",
        "gpt-4o",
        SettingsView.customModelPreset
    ]
    private static let defaultAnthropicModelPresets = [
        "claude-opus-4-8",
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
        "claude-fable-5",
        SettingsView.customModelPreset
    ]

    @Environment(AppState.self) private var appState
    private let secretStore = KeychainSecretStore()
    private let traktSyncService = TraktSyncService()
    private let imdbSyncService = IMDbCSVSyncService()
    private let modelCatalogService = AIModelCatalogService()

    @State private var isSaving = false
    @State private var statusMessage: String?

    @State private var tmdbApiKey = ""
    @State private var omdbApiKey = ""

    @State private var rdToken = ""
    @State private var adToken = ""
    @State private var pmToken = ""
    @State private var tbToken = ""

    @State private var preferredPlayer: PreferredPlayer = .auto
    @State private var internalPlayerBackend: InternalPlayerBackend = .automatic
    @State private var preferredQuality: VideoQuality = .hd1080p
    @State private var autoPlayNext = true
    @State private var subtitleLanguage = "en"

    @State private var indexerConfigs: [IndexerConfig] = []
    @State private var persistedIndexerIDs: Set<String> = []
    @State private var newIndexerType: IndexerConfig.IndexerType = .jackett
    @State private var newIndexerName = ""
    @State private var newIndexerBaseURL = ""
    @State private var newIndexerApiKey = ""
    @State private var newIndexerEndpointPath = "/api"
    @State private var newIndexerCategoryFilter = ""
    @State private var newIndexerPriority = 10
    @State private var isTestingIndexer = false
    @State private var indexerTestStatus: String?

    @State private var openAIApiKey = ""
    @State private var anthropicApiKey = ""
    @State private var openAIModelPresets = SettingsView.defaultOpenAIModelPresets
    @State private var anthropicModelPresets = SettingsView.defaultAnthropicModelPresets
    @State private var openAIModelPreset = "gpt-4.1-mini"
    @State private var openAIModelCustom = ""
    @State private var anthropicModelPreset = "claude-sonnet-4-6"
    @State private var anthropicModelCustom = ""
    @State private var isRefreshingModelCatalog = false
    @State private var modelCatalogStatus: String?
    @State private var aiUsageInputTokens = 0
    @State private var aiUsageOutputTokens = 0
    @State private var aiUsageEstimatedCostUSD = 0.0
    @State private var ollamaEndpoint = "http://localhost:11434/api/chat"
    @State private var aiCompareMode = true
    @State private var traktClientId = ""
    @State private var traktClientSecret = ""
    @State private var pendingTraktDeviceCode: String?
    @State private var traktUserCode: String?
    @State private var traktVerificationURL: String?

    // Imports & sync (new)
    @State private var importDestination: UserLibraryEntry.ListType = .favorites
    @State private var importFolderName = ""
    @State private var importPreviewCount = 0
    @State private var pendingCSVContents: String?
    @State private var isImportingIMDb = false
    @State private var isShowingImportWizard = false

    @State private var exportListType: UserLibraryEntry.ListType = .favorites
    @State private var availableExportFolders: [LibraryFolder] = []
    @State private var selectedExportFolderID: String?
    @State private var exportDocument: CSVTextDocument?
    @State private var isExportingIMDb = false

    // Personalization (new)
    @State private var personalizationEnabled = false
    @State private var aiCurationOnLaunch = false
    @State private var favoriteGenres = ""
    @State private var avoidGenres = ""
    @State private var preferredEras = ""
    @State private var toneMoodTags = ""
    @State private var currentVibeNotes = ""
    @State private var recencySensitivity = 0.7
    @State private var feedbackScaleMode: FeedbackScaleMode = .likeDislike

    var body: some View {
        @Bindable var state = appState

        TabView(selection: $state.selectedSettingsTab) {
            generalTab
                .tabItem { Label("General", systemImage: "gear") }
                .tag(SettingsTab.general)

            debridTab
                .tabItem { Label("Debrid", systemImage: "bolt.fill") }
                .tag(SettingsTab.debrid)

            indexerTab
                .tabItem { Label("Indexers", systemImage: "magnifyingglass") }
                .tag(SettingsTab.indexers)

            playerTab
                .tabItem { Label("Player", systemImage: "play.circle") }
                .tag(SettingsTab.player)

            aiSyncTab
                .tabItem { Label("AI & Sync", systemImage: "wand.and.stars") }
                .tag(SettingsTab.aiSync)

            importsSyncTab
                .tabItem { Label("Imports & Sync", systemImage: "square.and.arrow.down.on.square") }
                .tag(SettingsTab.importsSync)

            personalizationTab
                .tabItem { Label("Personalization", systemImage: "brain.head.profile") }
                .tag(SettingsTab.personalization)
        }
        // Fill the in-app detail pane (top-aligned) with a capped width instead of a
        // fixed centered "island in a void" (L2); still reasonable in the Settings scene.
        .frame(minWidth: 620, idealWidth: 760, maxWidth: 880, minHeight: 520, maxHeight: .infinity, alignment: .top)
        .task {
            await loadSettings()
            await refreshModelCatalog(silentIfNoKeys: true)
        }
        .fileImporter(
            isPresented: $isImportingIMDb,
            allowedContentTypes: [UTType.commaSeparatedText, UTType.plainText],
            allowsMultipleSelection: false
        ) { result in
            Task { await handleCSVFilePick(result) }
        }
        .fileExporter(
            isPresented: $isExportingIMDb,
            document: exportDocument,
            contentType: .commaSeparatedText,
            defaultFilename: "debridstreamer-export"
        ) { _ in }
        .sheet(isPresented: $isShowingImportWizard) {
            importWizardSheet
                .frame(minWidth: 480, minHeight: 360)
        }
    }

    private var generalTab: some View {
        Form {
            Section("API Keys") {
                NativeSecureField(placeholder: "TMDB API Key", text: $tmdbApiKey)
                NativeSecureField(placeholder: "OMDB API Key (optional)", text: $omdbApiKey)
                Text("TMDB is required for Discover. OMDB enriches ratings.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                HStack {
                    Spacer()
                    Button("Save") { Task { await saveGeneralSettings() } }
                        .buttonStyle(.glassProminent)
                        .disabled(isSaving)
                    Spacer()
                }
            }

            statusSection(for: [.general])
        }
        .scrollContentBackground(.hidden)
        .padding()
    }

    private var debridTab: some View {
        Form {
            Section("Real-Debrid") {
                NativeSecureField(placeholder: "API Token", text: $rdToken)
            }
            Section("AllDebrid") {
                NativeSecureField(placeholder: "API Key", text: $adToken)
            }
            Section("Premiumize") {
                NativeSecureField(placeholder: "API Key", text: $pmToken)
            }
            Section("TorBox") {
                NativeSecureField(placeholder: "API Key", text: $tbToken)
            }
            Section {
                HStack {
                    Spacer()
                    Button("Save Debrid Settings") { Task { await saveDebridSettings() } }
                        .buttonStyle(.glassProminent)
                    Spacer()
                }
            }
            statusSection(for: [.debrid])
        }
        .scrollContentBackground(.hidden)
        .padding()
    }

    private var indexerTab: some View {
        Form {
            Section("Configured Indexers") {
                if indexerConfigs.isEmpty {
                    Text("No indexers configured yet.")
                        .foregroundStyle(.secondary)
                        .font(.caption)
                } else {
                    ForEach($indexerConfigs) { $config in
                        HStack(spacing: AppTheme.Spacing.sm) {
                            Toggle("", isOn: $config.isActive).labelsHidden()
                            VStack(alignment: .leading, spacing: AppTheme.Spacing.xxs) {
                                Text(config.displayName ?? config.type.displayName)
                                    .fontWeight(.semibold)
                                if !config.baseURL.isEmpty {
                                    Text(config.baseURL + config.endpointPath)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer()
                            if config.type != .builtIn {
                                Button("Remove") { removeIndexer(config.id) }
                            }
                        }
                        .padding(AppTheme.Spacing.sm)
                        .glassCard(radius: AppTheme.Radius.sm)
                    }
                }
            }

            Section("Add External Indexer") {
                Picker("Type", selection: $newIndexerType) {
                    Text(IndexerConfig.IndexerType.jackett.displayName).tag(IndexerConfig.IndexerType.jackett)
                    Text(IndexerConfig.IndexerType.prowlarr.displayName).tag(IndexerConfig.IndexerType.prowlarr)
                    Text(IndexerConfig.IndexerType.torznab.displayName).tag(IndexerConfig.IndexerType.torznab)
                }
                .onChange(of: newIndexerType) {
                    newIndexerEndpointPath = defaultEndpointPath(for: newIndexerType)
                }

                TextField("Display Name (optional)", text: $newIndexerName)
                TextField("Base URL", text: $newIndexerBaseURL)
                NativeSecureField(placeholder: "API Key (optional)", text: $newIndexerApiKey)
                TextField("Endpoint Path", text: $newIndexerEndpointPath)
                TextField("Category Filter (optional)", text: $newIndexerCategoryFilter)
                Stepper("Priority: \(newIndexerPriority)", value: $newIndexerPriority, in: 0...1000)

                HStack {
                    Button("Test Connection") { Task { await testDraftIndexerConnection() } }
                        .disabled(isTestingIndexer || newIndexerBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("Add Indexer") { addIndexerDraft() }
                        .disabled(newIndexerBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if let indexerTestStatus {
                    Text(indexerTestStatus)
                        .font(.caption)
                        .foregroundStyle(indexerTestStatus.contains("failed") ? AppTheme.danger : AppTheme.success)
                }
            }

            Section {
                HStack {
                    Spacer()
                    Button("Save Indexer Settings") { Task { await saveIndexerSettings() } }
                        .buttonStyle(.glassProminent)
                    Spacer()
                }
            }
            statusSection(for: [.indexers])
        }
        .scrollContentBackground(.hidden)
        .padding()
    }

    private var playerTab: some View {
        Form {
            Section("Playback") {
                Picker("Playback App", selection: $preferredPlayer) {
                    ForEach(PreferredPlayer.allCases, id: \.self) { option in
                        Text(option.displayName).tag(option)
                    }
                }
                Picker("Internal Backend", selection: $internalPlayerBackend) {
                    ForEach(InternalPlayerBackend.allCases, id: \.self) { option in
                        Text(option.displayName).tag(option)
                    }
                }
                Text("Internal playback uses VLCKit with in-app fullscreen and advanced controls.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker("Preferred Quality", selection: $preferredQuality) {
                    ForEach(VideoQuality.allCases, id: \.self) { quality in
                        Text(quality.rawValue).tag(quality)
                    }
                }
                Toggle("Auto-play next episode", isOn: $autoPlayNext)
            }
            Section("Subtitles") {
                Picker("Preferred Language", selection: $subtitleLanguage) {
                    Text("English").tag("en")
                    Text("Spanish").tag("es")
                    Text("French").tag("fr")
                    Text("German").tag("de")
                    Text("Portuguese").tag("pt")
                }
            }
            Section {
                HStack {
                    Spacer()
                    Button("Save Player Settings") { Task { await savePlayerSettings() } }
                        .buttonStyle(.glassProminent)
                    Spacer()
                }
            }
            statusSection(for: [.player])
        }
        .scrollContentBackground(.hidden)
        .padding()
    }

    private var aiSyncTab: some View {
        Form {
            Section("AI Providers (BYOK)") {
                NativeSecureField(placeholder: "OpenAI API Key", text: $openAIApiKey)
                NativeSecureField(placeholder: "Anthropic API Key", text: $anthropicApiKey)
                Picker("OpenAI Model", selection: $openAIModelPreset) {
                    ForEach(openAIModelPresets, id: \.self) { model in
                        Text(model == SettingsView.customModelPreset ? "Custom..." : model).tag(model)
                    }
                }
                if openAIModelPreset == SettingsView.customModelPreset {
                    TextField("Custom OpenAI model ID", text: $openAIModelCustom)
                }
                Picker("Anthropic Model", selection: $anthropicModelPreset) {
                    ForEach(anthropicModelPresets, id: \.self) { model in
                        Text(model == SettingsView.customModelPreset ? "Custom..." : model).tag(model)
                    }
                }
                if anthropicModelPreset == SettingsView.customModelPreset {
                    TextField("Custom Anthropic model ID", text: $anthropicModelCustom)
                }
                TextField("Ollama Endpoint", text: $ollamaEndpoint)
                Toggle("Enable compare mode by default", isOn: $aiCompareMode)
                Text("Selected model settings persist until you change them.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack(spacing: AppTheme.Spacing.sm) {
                    Button {
                        Task { await refreshModelCatalog() }
                    } label: {
                        if isRefreshingModelCatalog {
                            Label("Refreshing Models...", systemImage: "arrow.triangle.2.circlepath")
                        } else {
                            Label("Live Fetch Latest Models", systemImage: "arrow.clockwise.circle")
                        }
                    }
                    .disabled(isRefreshingModelCatalog)
                    .buttonStyle(.glass)

                    if let modelCatalogStatus {
                        Text(modelCatalogStatus)
                            .font(.caption)
                            .foregroundStyle(
                                modelCatalogStatus.lowercased().contains("fail")
                                    || modelCatalogStatus.lowercased().contains("error")
                                    ? AnyShapeStyle(AppTheme.warning)
                                    : AnyShapeStyle(.secondary)
                            )
                            .lineLimit(2)
                    }
                }
            }

            Section("Trakt") {
                NativeSecureField(placeholder: "Trakt Client ID", text: $traktClientId)
                NativeSecureField(placeholder: "Trakt Client Secret", text: $traktClientSecret)
                HStack(spacing: AppTheme.Spacing.sm) {
                    Button("Start Device Auth") { Task { await startTraktDeviceAuth() } }
                    Button("Complete Auth") { Task { await completeTraktDeviceAuth() } }
                        .disabled(pendingTraktDeviceCode == nil)
                }
                if let traktUserCode, let traktVerificationURL {
                    Text("User code: \(traktUserCode)")
                        .font(.caption)
                    Text(traktVerificationURL)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Section("AI Usage (Estimated)") {
                HStack {
                    Text("Input Tokens")
                    Spacer()
                    Text(aiUsageInputTokens.formatted())
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Text("Output Tokens")
                    Spacer()
                    Text(aiUsageOutputTokens.formatted())
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Text("Total Tokens")
                    Spacer()
                    Text((aiUsageInputTokens + aiUsageOutputTokens).formatted())
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Text("Estimated Cost (Lifetime)")
                    Spacer()
                    Text("$" + String(format: "%.4f", aiUsageEstimatedCostUSD))
                        .foregroundStyle(.secondary)
                }
                Text("Cost values are estimates based on model pricing heuristics and reported token usage.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Section {
                HStack {
                    Spacer()
                    Button("Save AI & Sync Settings") { Task { await saveAIAndSyncSettings() } }
                        .buttonStyle(.glassProminent)
                    Spacer()
                }
            }
            statusSection(for: [.aiSync])
        }
        .scrollContentBackground(.hidden)
        .padding()
    }

    private var importsSyncTab: some View {
        Form {
            Section("IMDb CSV Import") {
                Text("Library imports create a named folder. Watchlist imports go to the watchlist root.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Choose CSV File") {
                    isImportingIMDb = true
                }
                .buttonStyle(.glassProminent)
            }

            Section("CSV Export") {
                Picker("List", selection: $exportListType) {
                    Text("Library").tag(UserLibraryEntry.ListType.favorites)
                    Text("Watchlist").tag(UserLibraryEntry.ListType.watchlist)
                }
                if exportListType.supportsFolders {
                    Picker("Folder Scope", selection: $selectedExportFolderID) {
                        Text("Entire List Tree").tag(nil as String?)
                        ForEach(availableExportFolders.filter { $0.listType == exportListType }) { folder in
                            Text(folder.name).tag(folder.id as String?)
                        }
                    }
                } else {
                    Text("Watchlist exports always include the full watchlist root.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Button("Export CSV") {
                    Task { await prepareExport() }
                }
                .buttonStyle(.glass)
            }

            statusSection(for: [.importsSync])
        }
        .scrollContentBackground(.hidden)
        .padding()
        .onChange(of: exportListType) {
            selectedExportFolderID = nil
        }
    }

    private var personalizationTab: some View {
        Form {
            Section("Adaptive AI") {
                Toggle("Enable Personalized AI", isOn: $personalizationEnabled)
                Toggle("Generate AI-curated Discover on launch", isOn: $aiCurationOnLaunch)
                Picker("Feedback Mode", selection: $feedbackScaleMode) {
                    ForEach(FeedbackScaleMode.allCases) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
            }
            Section("Taste Profile") {
                TextField("Favorite genres (comma separated)", text: $favoriteGenres)
                TextField("Avoid genres (comma separated)", text: $avoidGenres)
                TextField("Preferred eras (e.g. 90s, 2000s)", text: $preferredEras)
                TextField("Tone / mood tags", text: $toneMoodTags)
                TextField("Current vibe notes", text: $currentVibeNotes, axis: .vertical)
                    .lineLimit(2...5)
                VStack(alignment: .leading) {
                    HStack {
                        Text("Recency sensitivity")
                        Spacer()
                        Text(String(format: "%.2f", recencySensitivity))
                            .foregroundStyle(.secondary)
                    }
                    Slider(value: $recencySensitivity, in: 0...1)
                }
            }
            Section {
                HStack {
                    Spacer()
                    Button("Save Personalization") {
                        Task { await savePersonalizationSettings() }
                    }
                    .buttonStyle(.glassProminent)
                    Spacer()
                }
            }
            statusSection(for: [.personalization])
        }
        .scrollContentBackground(.hidden)
        .padding()
    }

    private var importWizardSheet: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            Text("IMDb Import Wizard")
                .font(.title3)
                .fontWeight(.bold)
            Text("Step 1: choose destination. Library requires a folder name before import starts.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Picker("Destination", selection: $importDestination) {
                Text("Library").tag(UserLibraryEntry.ListType.favorites)
                Text("Watchlist").tag(UserLibraryEntry.ListType.watchlist)
            }
            .pickerStyle(.segmented)

            if importDestination.supportsFolders {
                TextField("Folder name", text: $importFolderName)
                    .textFieldStyle(.roundedBorder)
            } else {
                Text("Watchlist destination does not use folders.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text("Preview: \(importPreviewCount) rows ready to import.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer()
            HStack {
                Button("Cancel") {
                    pendingCSVContents = nil
                    isShowingImportWizard = false
                }
                Spacer()
                Button("Import") {
                    Task { await executeImportWizard() }
                }
                .buttonStyle(.glassProminent)
                .disabled(importDestination.supportsFolders && importFolderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(AppTheme.Spacing.lg)
        .onChange(of: importDestination) {
            guard let csv = pendingCSVContents else { return }
            importPreviewCount = imdbSyncService.parseCSV(csv, listType: importDestination).count
            if importDestination.supportsFolders && importFolderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                importFolderName = "Imported \(Date().formatted(date: .abbreviated, time: .omitted))"
            }
        }
    }

    @ViewBuilder
    private func statusSection(for tabs: Set<SettingsTab>) -> some View {
        if let statusMessage, tabs.contains(appState.selectedSettingsTab) {
            Section {
                Text(statusMessage)
                    .foregroundStyle(statusMessage.contains("Error") ? AppTheme.danger : AppTheme.success)
                    .font(.caption)
            }
        }
    }

    private func loadSettings() async {
        guard let settings = appState.settingsManager else { return }
        do {
            tmdbApiKey = try await settings.getValue(forKey: SettingsKeys.tmdbApiKey) ?? ""
            omdbApiKey = try await settings.getValue(forKey: SettingsKeys.omdbApiKey) ?? ""
            openAIApiKey = try await settings.getValue(forKey: SettingsKeys.openAIApiKey) ?? ""
            anthropicApiKey = try await settings.getValue(forKey: SettingsKeys.anthropicApiKey) ?? ""
            let storedOpenAIPreset = try await settings.getValue(forKey: SettingsKeys.openAIModelPreset)
            let storedAnthropicPreset = try await settings.getValue(forKey: SettingsKeys.anthropicModelPreset)
            openAIModelCustom = try await settings.getValue(forKey: SettingsKeys.openAIModelCustom) ?? ""
            anthropicModelCustom = try await settings.getValue(forKey: SettingsKeys.anthropicModelCustom) ?? ""
            if let storedOpenAIPreset {
                let trimmed = storedOpenAIPreset.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty, !openAIModelPresets.contains(trimmed) {
                    openAIModelCustom = trimmed
                }
            }
            if let storedAnthropicPreset {
                let trimmed = storedAnthropicPreset.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty, !anthropicModelPresets.contains(trimmed) {
                    anthropicModelCustom = trimmed
                }
            }
            openAIModelPreset = normalizedModelPreset(
                storedPreset: storedOpenAIPreset,
                storedCustom: openAIModelCustom,
                supportedPresets: openAIModelPresets,
                defaultPreset: "gpt-4.1-mini"
            )
            anthropicModelPreset = normalizedModelPreset(
                storedPreset: storedAnthropicPreset,
                storedCustom: anthropicModelCustom,
                supportedPresets: anthropicModelPresets,
                defaultPreset: "claude-sonnet-4-6"
            )
            ollamaEndpoint = try await settings.getValue(forKey: SettingsKeys.ollamaEndpoint) ?? "http://localhost:11434/api/chat"
            traktClientId = try await settings.getValue(forKey: SettingsKeys.traktClientId) ?? ""
            traktClientSecret = try await settings.getValue(forKey: SettingsKeys.traktClientSecret) ?? ""
            aiCompareMode = (try await settings.getValue(forKey: SettingsKeys.aiCompareMode)) != "false"

            preferredPlayer = try await settings.getPreferredPlayer()
            internalPlayerBackend = try await settings.getInternalPlayerBackend()
            preferredQuality = try await settings.getPreferredQuality()
            subtitleLanguage = try await settings.getSubtitleLanguage()
            autoPlayNext = (try await settings.getValue(forKey: SettingsKeys.autoPlayNext)) != "false"

            personalizationEnabled = (try await settings.getValue(forKey: SettingsKeys.personalizationEnabled)) == "true"
            aiCurationOnLaunch = (try await settings.getValue(forKey: SettingsKeys.discoverAICurationOnLaunch)) == "true"
            favoriteGenres = try await settings.getValue(forKey: SettingsKeys.favoriteGenres) ?? ""
            avoidGenres = try await settings.getValue(forKey: SettingsKeys.avoidGenres) ?? ""
            preferredEras = try await settings.getValue(forKey: SettingsKeys.preferredEras) ?? ""
            toneMoodTags = try await settings.getValue(forKey: SettingsKeys.toneMoodTags) ?? ""
            currentVibeNotes = try await settings.getValue(forKey: SettingsKeys.currentVibeNotes) ?? ""
            recencySensitivity = Double(try await settings.getValue(forKey: SettingsKeys.recencySensitivity) ?? "0.7") ?? 0.7
            feedbackScaleMode = try await settings.getFeedbackScaleMode()
            aiUsageInputTokens = try await settings.getAIUsageTotalInputTokens()
            aiUsageOutputTokens = try await settings.getAIUsageTotalOutputTokens()
            aiUsageEstimatedCostUSD = try await settings.getAIUsageTotalEstimatedCostUSD()

            if let db = appState.databaseManager {
                let configs = try await db.fetchAllDebridConfigs()
                for config in configs {
                    let token = try await resolveDebridToken(for: config) ?? ""
                    switch config.service {
                    case .realDebrid: rdToken = token
                    case .allDebrid: adToken = token
                    case .premiumize: pmToken = token
                    case .torBox: tbToken = token
                    }
                }
                var loadedIndexers = try await db.fetchAllIndexerConfigs()
                if !loadedIndexers.contains(where: { $0.type == .builtIn }) {
                    loadedIndexers.append(
                        IndexerConfig(
                            id: "built-in",
                            type: .builtIn,
                            baseURL: "",
                            apiKey: nil,
                            isActive: true,
                            displayName: "Built-in Scrapers",
                            providerSubtype: .builtIn,
                            endpointPath: "",
                            categoryFilter: nil,
                            priority: 0
                        )
                    )
                }
                indexerConfigs = loadedIndexers.sorted { $0.priority < $1.priority }
                persistedIndexerIDs = Set(loadedIndexers.map(\.id))
                availableExportFolders = try await db.fetchAllLibraryFolders()
            }
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func saveGeneralSettings() async {
        isSaving = true
        defer { isSaving = false }
        guard let settings = appState.settingsManager else {
            statusMessage = "Error: App not initialized"
            return
        }
        do {
            try await settings.setValue(tmdbApiKey.nilIfEmpty, forKey: SettingsKeys.tmdbApiKey)
            try await settings.setValue(omdbApiKey.nilIfEmpty, forKey: SettingsKeys.omdbApiKey)
            appState.updateTMDBService(apiKey: tmdbApiKey.trimmingCharacters(in: .whitespacesAndNewlines))
            statusMessage = "General settings saved."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func saveDebridSettings() async {
        guard let db = appState.databaseManager else {
            statusMessage = "Error: Database not initialized"
            return
        }
        let tokens: [(DebridServiceType, String)] = [
            (.realDebrid, rdToken),
            (.allDebrid, adToken),
            (.premiumize, pmToken),
            (.torBox, tbToken)
        ]
        do {
            for (service, token) in tokens {
                let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmedToken.isEmpty {
                    let secretKey = SecretKey.debridToken(service: service)
                    try await secretStore.setSecret(trimmedToken, for: secretKey)
                    let config = DebridConfig(
                        id: service.rawValue,
                        service: service,
                        apiToken: SecretReference.encode(key: secretKey),
                        isActive: true,
                        priority: tokens.firstIndex(where: { $0.0 == service }) ?? 0
                    )
                    try await db.saveDebridConfig(config)
                } else {
                    try await secretStore.deleteSecret(for: SecretKey.debridToken(service: service))
                    try await db.deleteDebridConfig(id: service.rawValue)
                }
            }
            await appState.reloadDebridServices()
            statusMessage = "Debrid settings saved."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func savePlayerSettings() async {
        guard let settings = appState.settingsManager else { return }
        do {
            try await settings.setPreferredPlayer(preferredPlayer)
            try await settings.setInternalPlayerBackend(internalPlayerBackend)
            try await settings.setPreferredQuality(preferredQuality)
            try await settings.setSubtitleLanguage(subtitleLanguage)
            try await settings.setValue(autoPlayNext ? "true" : "false", forKey: SettingsKeys.autoPlayNext)
            statusMessage = "Player settings saved."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func saveAIAndSyncSettings() async {
        guard let settings = appState.settingsManager else {
            statusMessage = "Error: Settings unavailable"
            return
        }
        do {
            try await settings.setValue(openAIApiKey.nilIfEmpty, forKey: SettingsKeys.openAIApiKey)
            try await settings.setValue(anthropicApiKey.nilIfEmpty, forKey: SettingsKeys.anthropicApiKey)
            try await settings.setValue(openAIModelPreset, forKey: SettingsKeys.openAIModelPreset)
            try await settings.setValue(
                openAIModelPreset == SettingsView.customModelPreset ? openAIModelCustom.nilIfEmpty : nil,
                forKey: SettingsKeys.openAIModelCustom
            )
            try await settings.setValue(anthropicModelPreset, forKey: SettingsKeys.anthropicModelPreset)
            try await settings.setValue(
                anthropicModelPreset == SettingsView.customModelPreset ? anthropicModelCustom.nilIfEmpty : nil,
                forKey: SettingsKeys.anthropicModelCustom
            )
            try await settings.setValue(ollamaEndpoint.nilIfEmpty, forKey: SettingsKeys.ollamaEndpoint)
            try await settings.setValue(aiCompareMode ? "true" : "false", forKey: SettingsKeys.aiCompareMode)
            try await settings.setValue(traktClientId.nilIfEmpty, forKey: SettingsKeys.traktClientId)
            try await settings.setValue(traktClientSecret.nilIfEmpty, forKey: SettingsKeys.traktClientSecret)
            await appState.reloadAIAssistantManager()
            statusMessage = "AI & Sync settings saved."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func savePersonalizationSettings() async {
        guard let settings = appState.settingsManager else { return }
        do {
            try await settings.setValue(personalizationEnabled ? "true" : "false", forKey: SettingsKeys.personalizationEnabled)
            try await settings.setValue(aiCurationOnLaunch ? "true" : "false", forKey: SettingsKeys.discoverAICurationOnLaunch)
            try await settings.setValue(favoriteGenres.nilIfEmpty, forKey: SettingsKeys.favoriteGenres)
            try await settings.setValue(avoidGenres.nilIfEmpty, forKey: SettingsKeys.avoidGenres)
            try await settings.setValue(preferredEras.nilIfEmpty, forKey: SettingsKeys.preferredEras)
            try await settings.setValue(toneMoodTags.nilIfEmpty, forKey: SettingsKeys.toneMoodTags)
            try await settings.setValue(currentVibeNotes.nilIfEmpty, forKey: SettingsKeys.currentVibeNotes)
            try await settings.setValue(String(recencySensitivity), forKey: SettingsKeys.recencySensitivity)
            try await settings.setFeedbackScaleMode(feedbackScaleMode)

            if let db = appState.databaseManager {
                let profile = UserTasteProfile(
                    userId: "default",
                    likedGenres: favoriteGenres.commaSeparated,
                    dislikedGenres: avoidGenres.commaSeparated,
                    preferredDecades: preferredEras.commaSeparated.compactMap { Int($0.filter(\.isNumber)) },
                    preferredLanguages: [],
                    eventCount: 0,
                    updatedAt: Date()
                )
                try await db.saveUserTasteProfile(profile)
            }

            await appState.preloadDiscoverAICuration(forceRefresh: true)
            statusMessage = "Personalization settings saved."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func startTraktDeviceAuth() async {
        guard !traktClientId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            statusMessage = "Error: Trakt client ID is required."
            return
        }
        do {
            let response = try await traktSyncService.startDeviceAuth(clientID: traktClientId)
            pendingTraktDeviceCode = response.deviceCode
            traktUserCode = response.userCode
            traktVerificationURL = response.verificationURL
            statusMessage = "Open Trakt and enter code \(response.userCode), then click Complete Auth."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func completeTraktDeviceAuth() async {
        guard let settings = appState.settingsManager else { return }
        guard let deviceCode = pendingTraktDeviceCode else {
            statusMessage = "Error: Start device auth first."
            return
        }
        guard !traktClientId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !traktClientSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            statusMessage = "Error: Trakt client ID and secret are required."
            return
        }
        do {
            let token = try await traktSyncService.exchangeDeviceCode(
                clientID: traktClientId,
                clientSecret: traktClientSecret,
                deviceCode: deviceCode
            )
            try await settings.setValue(token.accessToken, forKey: SettingsKeys.traktAccessToken)
            try await settings.setValue(token.refreshToken, forKey: SettingsKeys.traktRefreshToken)
            pendingTraktDeviceCode = nil
            traktUserCode = nil
            traktVerificationURL = nil
            statusMessage = "Trakt auth complete."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func saveIndexerSettings() async {
        guard let db = appState.databaseManager else {
            statusMessage = "Error: Database not initialized"
            return
        }
        do {
            let trimmedConfigs = indexerConfigs.map { config in
                var updated = config
                updated.baseURL = config.baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
                updated.endpointPath = config.endpointPath.trimmingCharacters(in: .whitespacesAndNewlines)
                updated.displayName = config.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
                return updated
            }
            for config in trimmedConfigs {
                try await db.saveIndexerConfig(config)
            }
            let currentIDs = Set(trimmedConfigs.map(\.id))
            for id in persistedIndexerIDs.subtracting(currentIDs) {
                try await db.deleteIndexerConfig(id: id)
            }
            persistedIndexerIDs = currentIDs
            await appState.reloadIndexers()
            statusMessage = "Indexer settings saved."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func addIndexerDraft() {
        let baseURL = newIndexerBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !baseURL.isEmpty else { return }

        let config = IndexerConfig(
            id: "idx-\(UUID().uuidString)",
            type: newIndexerType,
            baseURL: baseURL,
            apiKey: newIndexerApiKey.nilIfEmpty,
            isActive: true,
            displayName: newIndexerName.nilIfEmpty,
            providerSubtype: providerSubtype(for: newIndexerType),
            endpointPath: newIndexerEndpointPath.trimmingCharacters(in: .whitespacesAndNewlines),
            categoryFilter: newIndexerCategoryFilter.nilIfEmpty,
            priority: newIndexerPriority
        )

        indexerConfigs.append(config)
        indexerConfigs.sort { $0.priority < $1.priority }
        newIndexerName = ""
        newIndexerBaseURL = ""
        newIndexerApiKey = ""
        newIndexerCategoryFilter = ""
        newIndexerEndpointPath = defaultEndpointPath(for: newIndexerType)
        newIndexerPriority = 10
        indexerTestStatus = nil
    }

    private func removeIndexer(_ id: String) {
        indexerConfigs.removeAll { $0.id == id }
    }

    private func testDraftIndexerConnection() async {
        let baseURL = newIndexerBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !baseURL.isEmpty else { return }
        isTestingIndexer = true
        defer { isTestingIndexer = false }
        let config = IndexerConfig(
            id: "test-\(UUID().uuidString)",
            type: newIndexerType,
            baseURL: baseURL,
            apiKey: newIndexerApiKey.nilIfEmpty,
            isActive: true,
            displayName: newIndexerName.nilIfEmpty,
            providerSubtype: providerSubtype(for: newIndexerType),
            endpointPath: newIndexerEndpointPath.trimmingCharacters(in: .whitespacesAndNewlines),
            categoryFilter: newIndexerCategoryFilter.nilIfEmpty,
            priority: newIndexerPriority
        )
        let success = await IndexerFactory.testConnection(config: config)
        indexerTestStatus = success ? "Connection succeeded." : "Connection failed."
    }

    private func defaultEndpointPath(for type: IndexerConfig.IndexerType) -> String {
        switch type {
        case .jackett: return "/api/v2.0/indexers/all/results/torznab/api"
        case .prowlarr: return "/api/v1/search"
        case .torznab, .zilean: return "/api"
        case .builtIn: return ""
        }
    }

    private func providerSubtype(for type: IndexerConfig.IndexerType) -> IndexerConfig.ProviderSubtype {
        switch type {
        case .jackett: return .jackett
        case .prowlarr: return .prowlarr
        case .torznab, .zilean: return .customTorznab
        case .builtIn: return .builtIn
        }
    }

    private func resolveDebridToken(for config: DebridConfig) async throws -> String? {
        if let secretKey = SecretReference.decode(config.apiToken) {
            return try await secretStore.getSecret(for: secretKey)
        }

        let secretKey = SecretKey.debridToken(service: config.service)
        try await secretStore.setSecret(config.apiToken, for: secretKey)
        if let db = appState.databaseManager {
            var migrated = config
            migrated.apiToken = SecretReference.encode(key: secretKey)
            try await db.saveDebridConfig(migrated)
        }
        return config.apiToken
    }

    private func handleCSVFilePick(_ result: Result<[URL], Error>) async {
        do {
            let urls = try result.get()
            guard let url = urls.first else { return }
            let data = try Data(contentsOf: url)
            guard let text = String(data: data, encoding: .utf8) else {
                statusMessage = "Error: Could not read CSV file."
                return
            }

            pendingCSVContents = text
            importDestination = .favorites
            importFolderName = defaultFolderName(from: url)
            importPreviewCount = imdbSyncService.parseCSV(text, listType: importDestination).count
            isShowingImportWizard = true
            appState.selectedSettingsTab = .importsSync
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func executeImportWizard() async {
        guard let db = appState.databaseManager else {
            statusMessage = "Error: Database not initialized."
            return
        }
        guard let csv = pendingCSVContents else {
            statusMessage = "Error: No CSV contents loaded."
            return
        }

        do {
            let targetFolderID: String
            var targetFolderName = LibraryFolder.systemFolderName(for: importDestination)

            if importDestination.supportsFolders {
                let folderName = importFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !folderName.isEmpty else {
                    statusMessage = "Error: Folder name is required."
                    return
                }

                let systemRootId = try await db.fetchSystemLibraryFolderID(listType: importDestination)
                let folder = try await db.createLibraryFolder(
                    name: folderName,
                    listType: importDestination,
                    parentId: systemRootId
                )
                targetFolderID = folder.id
                targetFolderName = folder.name
            } else {
                targetFolderID = try await db.fetchSystemLibraryFolderID(listType: importDestination)
            }

            let result = try await imdbSyncService.importCSV(
                csv,
                listType: importDestination,
                folderId: targetFolderID,
                database: db
            )
            availableExportFolders = try await db.fetchAllLibraryFolders()
            isShowingImportWizard = false
            pendingCSVContents = nil
            statusMessage = "IMDb import complete. Destination \"\(targetFolderName)\": added \(result.added), skipped \(result.skippedDuplicates)."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func prepareExport() async {
        guard let db = appState.databaseManager else {
            statusMessage = "Error: Database not initialized."
            return
        }
        do {
            availableExportFolders = try await db.fetchAllLibraryFolders()
            if let selectedExportFolderID,
               availableExportFolders.contains(where: { $0.id == selectedExportFolderID }) == false {
                self.selectedExportFolderID = nil
            }

            let csv: String
            if let selectedExportFolderID {
                csv = try await imdbSyncService.exportCSV(
                    database: db,
                    folderId: selectedExportFolderID,
                    includeDescendants: true
                )
            } else {
                let rootId = try await db.fetchSystemLibraryFolderID(listType: exportListType)
                csv = try await imdbSyncService.exportCSVAllFolders(database: db, rootFolderId: rootId)
            }
            exportDocument = CSVTextDocument(text: csv)
            isExportingIMDb = true
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func refreshModelCatalog(silentIfNoKeys: Bool = false) async {
        if isRefreshingModelCatalog {
            return
        }

        let openAIKey = openAIApiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let anthropicKey = anthropicApiKey.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !openAIKey.isEmpty || !anthropicKey.isEmpty else {
            if !silentIfNoKeys {
                modelCatalogStatus = "Add an API key to fetch latest model IDs."
            }
            return
        }

        isRefreshingModelCatalog = true
        defer { isRefreshingModelCatalog = false }

        var resultNotes: [String] = []

        if !openAIKey.isEmpty {
            do {
                let openAIModels = try await modelCatalogService.fetchOpenAIModelIDs(apiKey: openAIKey)
                if !openAIModels.isEmpty {
                    openAIModelPresets = mergedModelPresetList(
                        liveModels: openAIModels,
                        fallback: SettingsView.defaultOpenAIModelPresets
                    )
                    preserveOrConvertSelectionToCustom(
                        availablePresets: openAIModelPresets,
                        selectedPreset: &openAIModelPreset,
                        customValue: &openAIModelCustom
                    )
                    resultNotes.append("OpenAI: \(openAIModels.count)")
                } else {
                    resultNotes.append("OpenAI: no models returned")
                }
            } catch {
                resultNotes.append("OpenAI fetch failed")
            }
        }

        if !anthropicKey.isEmpty {
            do {
                let anthropicModels = try await modelCatalogService.fetchAnthropicModelIDs(apiKey: anthropicKey)
                if !anthropicModels.isEmpty {
                    anthropicModelPresets = mergedModelPresetList(
                        liveModels: anthropicModels,
                        fallback: SettingsView.defaultAnthropicModelPresets
                    )
                    preserveOrConvertSelectionToCustom(
                        availablePresets: anthropicModelPresets,
                        selectedPreset: &anthropicModelPreset,
                        customValue: &anthropicModelCustom
                    )
                    resultNotes.append("Anthropic: \(anthropicModels.count)")
                } else {
                    resultNotes.append("Anthropic: no models returned")
                }
            } catch {
                resultNotes.append("Anthropic fetch failed")
            }
        }

        if resultNotes.isEmpty {
            if !silentIfNoKeys {
                modelCatalogStatus = "Unable to fetch model catalogs."
            }
        } else {
            modelCatalogStatus = "Live model catalogs updated (\(resultNotes.joined(separator: ", ")))."
        }
    }

    private func defaultFolderName(from url: URL) -> String {
        let base = url.deletingPathExtension().lastPathComponent
        let timestamp = ISO8601DateFormatter().string(from: Date())
        return "\(base) \(timestamp.prefix(10))"
    }

    private func normalizedModelPreset(
        storedPreset: String?,
        storedCustom: String,
        supportedPresets: [String],
        defaultPreset: String
    ) -> String {
        let trimmed = storedPreset?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if supportedPresets.contains(trimmed) {
            if trimmed == SettingsView.customModelPreset, storedCustom.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return defaultPreset
            }
            return trimmed
        }

        if !trimmed.isEmpty {
            return SettingsView.customModelPreset
        }

        if !storedCustom.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return SettingsView.customModelPreset
        }

        return defaultPreset
    }

    private func mergedModelPresetList(liveModels: [String], fallback: [String]) -> [String] {
        var seen = Set<String>()
        var merged: [String] = []

        let combined = liveModels + fallback
        for raw in combined {
            let model = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !model.isEmpty else { continue }
            if model == SettingsView.customModelPreset { continue }
            let key = model.lowercased()
            if seen.insert(key).inserted {
                merged.append(model)
            }
        }

        merged.sort { lhs, rhs in
            lhs.localizedCaseInsensitiveCompare(rhs) == .orderedDescending
        }
        merged.append(SettingsView.customModelPreset)
        return merged
    }

    private func preserveOrConvertSelectionToCustom(
        availablePresets: [String],
        selectedPreset: inout String,
        customValue: inout String
    ) {
        if selectedPreset == SettingsView.customModelPreset {
            return
        }

        if availablePresets.contains(selectedPreset) {
            return
        }

        if !selectedPreset.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            customValue = selectedPreset
            selectedPreset = SettingsView.customModelPreset
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    var commaSeparated: [String] {
        split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

private struct CSVTextDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.commaSeparatedText, .plainText] }
    var text: String

    init(text: String) {
        self.text = text
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents,
              let text = String(data: data, encoding: .utf8) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.text = text
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}
