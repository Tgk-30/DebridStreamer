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
    @State private var editingIndexerID: String?

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
    @State private var traktConnected = false
    @State private var isImportingTraktWatchlist = false

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

        VStack(spacing: 0) {
            settingsHeader(for: state.selectedSettingsTab)
            settingsTabBar(selection: $state.selectedSettingsTab)
            Divider().opacity(0.4)
            ScrollView {
                VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
                    tabContent(for: state.selectedSettingsTab)
                }
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .top)   // center the 720 column horizontally
                .padding(AppTheme.Spacing.xl)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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

    // MARK: - Layout scaffolding

    @ViewBuilder
    private func tabContent(for tab: SettingsTab) -> some View {
        switch tab {
        case .general: generalTab
        case .debrid: debridTab
        case .indexers: indexerTab
        case .player: playerTab
        case .aiSync: aiSyncTab
        case .importsSync: importsSyncTab
        case .personalization: personalizationTab
        }
    }

    private func settingsTabMeta(_ tab: SettingsTab) -> (title: String, icon: String) {
        switch tab {
        case .general: return ("General", "gear")
        case .debrid: return ("Debrid", "bolt.fill")
        case .indexers: return ("Indexers", "magnifyingglass")
        case .player: return ("Player", "play.circle")
        case .aiSync: return ("AI & Sync", "wand.and.stars")
        case .importsSync: return ("Imports & Sync", "square.and.arrow.down.on.square")
        case .personalization: return ("Personalization", "brain.head.profile")
        }
    }

    private func settingsHeader(for tab: SettingsTab) -> some View {
        let meta = settingsTabMeta(tab)
        return HStack(spacing: AppTheme.Spacing.sm) {
            Image(systemName: meta.icon)
                .font(.title2)
                .foregroundStyle(AppTheme.accent)
            Text(meta.title)
                .font(.title2.bold())
            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, AppTheme.Spacing.xl)
        .padding(.top, AppTheme.Spacing.lg)
        .padding(.bottom, AppTheme.Spacing.md)
    }

    private func settingsTabBar(selection: Binding<SettingsTab>) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AppTheme.Spacing.sm) {
                ForEach(SettingsTab.allCases, id: \.self) { tab in
                    let meta = settingsTabMeta(tab)
                    let isSelected = selection.wrappedValue == tab
                    Button {
                        selection.wrappedValue = tab
                    } label: {
                        HStack(spacing: AppTheme.Spacing.xs) {
                            Image(systemName: meta.icon)
                            Text(meta.title)
                        }
                        .font(.callout.weight(.medium))
                        .padding(.horizontal, AppTheme.Spacing.md)
                        .padding(.vertical, AppTheme.Spacing.sm)
                        .foregroundStyle(isSelected ? AnyShapeStyle(AppTheme.accent) : AnyShapeStyle(.secondary))
                        .background {
                            if isSelected {
                                Capsule().fill(AppTheme.accent.opacity(0.22))
                            } else {
                                Capsule().fill(.ultraThinMaterial)
                            }
                        }
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, AppTheme.Spacing.xl)
        }
    }

    @ViewBuilder
    private func settingsCard<Content: View>(_ title: String?, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            if let title {
                Text(title).font(.headline)
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AppTheme.Spacing.lg)
        .glassPanel(radius: AppTheme.Radius.lg, level: .ultraThin)
    }

    private func saveBar(_ title: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        HStack {
            Spacer()
            Button(title, action: action)
                .buttonStyle(.glassProminent)
                .disabled(disabled)
        }
    }

    @ViewBuilder
    private func statusView(for tabs: [SettingsTab]) -> some View {
        if let statusMessage, tabs.contains(appState.selectedSettingsTab) {
            settingsCard(nil) {
                Text(statusMessage)
                    .foregroundStyle(statusMessage.contains("Error") ? AppTheme.danger : AppTheme.success)
                    .font(.caption)
            }
        }
    }

    private var generalTab: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
            settingsCard("API Keys") {
                NativeSecureField(placeholder: "TMDB API Key", text: $tmdbApiKey)
                NativeSecureField(placeholder: "OMDB API Key (optional)", text: $omdbApiKey)
                Text("TMDB is required for Discover. OMDB enriches ratings.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            saveBar("Save", disabled: isSaving) { Task { await saveGeneralSettings() } }

            statusView(for: [.general])
        }
    }

    private var debridTab: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
            settingsCard("Real-Debrid") {
                NativeSecureField(placeholder: "API Token", text: $rdToken)
            }
            settingsCard("AllDebrid") {
                NativeSecureField(placeholder: "API Key", text: $adToken)
            }
            settingsCard("Premiumize") {
                NativeSecureField(placeholder: "API Key", text: $pmToken)
            }
            settingsCard("TorBox") {
                NativeSecureField(placeholder: "API Key", text: $tbToken)
            }
            saveBar("Save Debrid Settings") { Task { await saveDebridSettings() } }
            statusView(for: [.debrid])
        }
    }

    private var indexerTab: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
            settingsCard("Sources") {
                Text("Stream sources are searched top to bottom. Reorder by priority, toggle on or off, edit, or remove. Add Stremio addons to plug in the Torrentio-compatible ecosystem.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if indexerConfigs.isEmpty {
                    Text("No sources configured yet.")
                        .foregroundStyle(.secondary)
                        .font(.caption)
                } else {
                    ForEach(Array(indexerConfigs.enumerated()), id: \.element.id) { index, _ in
                        sourceRow(at: index)
                    }
                }
            }

            settingsCard("Add Source") {
                Picker("Type", selection: $newIndexerType) {
                    Text(IndexerConfig.IndexerType.jackett.displayName).tag(IndexerConfig.IndexerType.jackett)
                    Text(IndexerConfig.IndexerType.prowlarr.displayName).tag(IndexerConfig.IndexerType.prowlarr)
                    Text(IndexerConfig.IndexerType.torznab.displayName).tag(IndexerConfig.IndexerType.torznab)
                    Text(IndexerConfig.IndexerType.stremioAddon.displayName).tag(IndexerConfig.IndexerType.stremioAddon)
                }
                .onChange(of: newIndexerType) {
                    newIndexerEndpointPath = defaultEndpointPath(for: newIndexerType)
                }

                TextField("Display name (optional)", text: $newIndexerName)
                    .textFieldStyle(.roundedBorder)
                TextField(
                    newIndexerType == .stremioAddon ? "Addon base or manifest URL" : "Base URL",
                    text: $newIndexerBaseURL
                )
                .textFieldStyle(.roundedBorder)

                if draftShowsTorznabFields {
                    NativeSecureField(placeholder: "API key (optional)", text: $newIndexerApiKey)
                    TextField("Endpoint path", text: $newIndexerEndpointPath)
                        .textFieldStyle(.roundedBorder)
                    TextField("Category filter (optional)", text: $newIndexerCategoryFilter)
                        .textFieldStyle(.roundedBorder)
                } else {
                    Text("Stremio addons resolve streams by IMDb id via /stream/{type}/{id}.json. Paste the addon's base URL (the part before /manifest.json) or the full manifest URL.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Stepper("Priority: \(newIndexerPriority)", value: $newIndexerPriority, in: 0...1000)

                HStack {
                    Button("Test connection") { Task { await testDraftIndexerConnection() } }
                        .disabled(isTestingIndexer || newIndexerBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("Add source") { addIndexerDraft() }
                        .disabled(newIndexerBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if let indexerTestStatus {
                    Text(indexerTestStatus)
                        .font(.caption)
                        .foregroundStyle(indexerTestStatus.localizedCaseInsensitiveContains("failed") ? AppTheme.danger : AppTheme.success)
                }
            }

            saveBar("Save sources") { Task { await saveIndexerSettings() } }
            statusView(for: [.indexers])
        }
    }

    @ViewBuilder
    private func sourceRow(at index: Int) -> some View {
        let config = indexerConfigs[index]
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            HStack(spacing: AppTheme.Spacing.sm) {
                Toggle("", isOn: Binding(
                    get: { indexerConfigs[index].isActive },
                    set: { indexerConfigs[index].isActive = $0 }
                ))
                .labelsHidden()

                VStack(alignment: .leading, spacing: AppTheme.Spacing.xxs) {
                    HStack(spacing: AppTheme.Spacing.xs) {
                        Text(config.displayName?.nilIfEmpty ?? config.type.displayName)
                            .fontWeight(.semibold)
                        Text(config.type.displayName)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(.ultraThinMaterial))
                            .foregroundStyle(.secondary)
                    }
                    if !config.baseURL.isEmpty {
                        Text(config.baseURL + config.endpointPath)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer()
                Text("P\(config.priority)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)

                Button {
                    moveSource(at: index, by: -1)
                } label: {
                    Image(systemName: "chevron.up")
                }
                .buttonStyle(.plain)
                .disabled(index == 0)

                Button {
                    moveSource(at: index, by: 1)
                } label: {
                    Image(systemName: "chevron.down")
                }
                .buttonStyle(.plain)
                .disabled(index == indexerConfigs.count - 1)
            }

            if config.type != .builtIn {
                HStack(spacing: AppTheme.Spacing.sm) {
                    Button(editingIndexerID == config.id ? "Done" : "Edit") {
                        editingIndexerID = (editingIndexerID == config.id) ? nil : config.id
                    }
                    Button("Remove", role: .destructive) { removeIndexer(config.id) }
                    Spacer()
                }
                .font(.caption)

                if editingIndexerID == config.id {
                    sourceEditor(at: index)
                }
            }
        }
        .padding(AppTheme.Spacing.sm)
        .glassCard(radius: AppTheme.Radius.sm)
    }

    @ViewBuilder
    private func sourceEditor(at index: Int) -> some View {
        let isStremio = indexerConfigs[index].type == .stremioAddon
        VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
            TextField("Display name", text: Binding(
                get: { indexerConfigs[index].displayName ?? "" },
                set: { indexerConfigs[index].displayName = $0.nilIfEmpty }
            ))
            .textFieldStyle(.roundedBorder)

            TextField("Base URL", text: Binding(
                get: { indexerConfigs[index].baseURL },
                set: { indexerConfigs[index].baseURL = $0 }
            ))
            .textFieldStyle(.roundedBorder)

            if !isStremio {
                NativeSecureField(placeholder: "API key (optional)", text: Binding(
                    get: { indexerConfigs[index].apiKey ?? "" },
                    set: { indexerConfigs[index].apiKey = $0.nilIfEmpty }
                ))
                TextField("Endpoint path", text: Binding(
                    get: { indexerConfigs[index].endpointPath },
                    set: { indexerConfigs[index].endpointPath = $0 }
                ))
                .textFieldStyle(.roundedBorder)
                TextField("Category filter (optional)", text: Binding(
                    get: { indexerConfigs[index].categoryFilter ?? "" },
                    set: { indexerConfigs[index].categoryFilter = $0.nilIfEmpty }
                ))
                .textFieldStyle(.roundedBorder)
            }

            Stepper("Priority: \(indexerConfigs[index].priority)", value: Binding(
                get: { indexerConfigs[index].priority },
                set: { indexerConfigs[index].priority = $0 }
            ), in: 0...1000)
        }
        .padding(.top, AppTheme.Spacing.xs)
    }

    /// Swaps a source with its neighbor and re-derives contiguous priorities so the
    /// new visual order is the persisted search order.
    private func moveSource(at index: Int, by offset: Int) {
        let target = index + offset
        guard indexerConfigs.indices.contains(index), indexerConfigs.indices.contains(target) else { return }
        indexerConfigs.swapAt(index, target)
        reindexPriorities()
    }

    /// Renumbers priorities to match the current array order (0-based, step 10),
    /// so reordering and the persisted `priority` field stay in sync.
    private func reindexPriorities() {
        for (offset, _) in indexerConfigs.enumerated() {
            indexerConfigs[offset].priority = offset * 10
        }
    }

    private var playerTab: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
            settingsCard("Playback") {
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
            settingsCard("Subtitles") {
                Picker("Preferred Language", selection: $subtitleLanguage) {
                    Text("English").tag("en")
                    Text("Spanish").tag("es")
                    Text("French").tag("fr")
                    Text("German").tag("de")
                    Text("Portuguese").tag("pt")
                }
            }
            saveBar("Save Player Settings") { Task { await savePlayerSettings() } }
            statusView(for: [.player])
        }
    }

    private var aiSyncTab: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
            settingsCard("AI Providers (BYOK)") {
                NativeSecureField(placeholder: "OpenAI API Key", text: $openAIApiKey)
                NativeSecureField(placeholder: "Anthropic API Key", text: $anthropicApiKey)
                Picker("OpenAI Model", selection: $openAIModelPreset) {
                    ForEach(openAIModelPresets, id: \.self) { model in
                        Text(model == SettingsView.customModelPreset ? "Custom..." : model).tag(model)
                    }
                }
                if openAIModelPreset == SettingsView.customModelPreset {
                    TextField("Custom OpenAI model ID", text: $openAIModelCustom)
                        .textFieldStyle(.roundedBorder)
                }
                Picker("Anthropic Model", selection: $anthropicModelPreset) {
                    ForEach(anthropicModelPresets, id: \.self) { model in
                        Text(model == SettingsView.customModelPreset ? "Custom..." : model).tag(model)
                    }
                }
                if anthropicModelPreset == SettingsView.customModelPreset {
                    TextField("Custom Anthropic model ID", text: $anthropicModelCustom)
                        .textFieldStyle(.roundedBorder)
                }
                TextField("Ollama Endpoint", text: $ollamaEndpoint)
                    .textFieldStyle(.roundedBorder)
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

            settingsCard("Trakt") {
                HStack(spacing: AppTheme.Spacing.xs) {
                    Image(systemName: traktConnected ? "checkmark.circle.fill" : "circle.dashed")
                        .foregroundStyle(traktConnected ? AnyShapeStyle(AppTheme.success) : AnyShapeStyle(.secondary))
                    Text(traktConnected ? "Connected" : "Not connected")
                        .font(.callout.weight(.medium))
                    Spacer()
                    if traktConnected {
                        Button("Disconnect", role: .destructive) { Task { await disconnectTrakt() } }
                            .font(.caption)
                    }
                }

                NativeSecureField(placeholder: "Trakt client ID", text: $traktClientId)
                NativeSecureField(placeholder: "Trakt client secret", text: $traktClientSecret)
                HStack(spacing: AppTheme.Spacing.sm) {
                    Button("Start device auth") { Task { await startTraktDeviceAuth() } }
                    Button("Complete auth") { Task { await completeTraktDeviceAuth() } }
                        .disabled(pendingTraktDeviceCode == nil)
                }
                if let traktUserCode, let traktVerificationURL {
                    Text("User code: \(traktUserCode)")
                        .font(.caption)
                    Text(traktVerificationURL)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Divider().opacity(0.3)

                Text("Import your Trakt movie watchlist into the local watchlist. Scrobbling of playback progress happens automatically while connected.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button {
                    Task { await importTraktWatchlist() }
                } label: {
                    if isImportingTraktWatchlist {
                        Label("Importing watchlist...", systemImage: "arrow.triangle.2.circlepath")
                    } else {
                        Label("Import Trakt watchlist", systemImage: "square.and.arrow.down")
                    }
                }
                .buttonStyle(.glass)
                .disabled(!traktConnected || isImportingTraktWatchlist)
            }

            settingsCard("AI Usage (Estimated)") {
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

            saveBar("Save AI & Sync Settings") { Task { await saveAIAndSyncSettings() } }
            statusView(for: [.aiSync])
        }
    }

    private var importsSyncTab: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
            settingsCard("IMDb CSV Import") {
                Text("Library imports create a named folder. Watchlist imports go to the watchlist root.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Choose CSV File") {
                    isImportingIMDb = true
                }
                .buttonStyle(.glassProminent)
            }

            settingsCard("CSV Export") {
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

            statusView(for: [.importsSync])
        }
        .onChange(of: exportListType) {
            selectedExportFolderID = nil
        }
    }

    private var personalizationTab: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
            settingsCard("Adaptive AI") {
                Toggle("Enable Personalized AI", isOn: $personalizationEnabled)
                Toggle("Generate AI-curated Discover on launch", isOn: $aiCurationOnLaunch)
                Picker("Feedback Mode", selection: $feedbackScaleMode) {
                    ForEach(FeedbackScaleMode.allCases) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
            }
            settingsCard("Taste Profile") {
                TextField("Favorite genres (comma separated)", text: $favoriteGenres)
                    .textFieldStyle(.roundedBorder)
                TextField("Avoid genres (comma separated)", text: $avoidGenres)
                    .textFieldStyle(.roundedBorder)
                TextField("Preferred eras (e.g. 90s, 2000s)", text: $preferredEras)
                    .textFieldStyle(.roundedBorder)
                TextField("Tone / mood tags", text: $toneMoodTags)
                    .textFieldStyle(.roundedBorder)
                TextField("Current vibe notes", text: $currentVibeNotes, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
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
            saveBar("Save Personalization") { Task { await savePersonalizationSettings() } }
            statusView(for: [.personalization])
        }
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
            traktConnected = await appState.traktCoordinator?.isConnected() ?? false
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
            appState.updateOMDBService(apiKey: omdbApiKey.trimmingCharacters(in: .whitespacesAndNewlines))
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
        // Ensure client id/secret are persisted before completing, so the coordinator
        // (and later token refresh) can read them back from settings.
        try? await settings.setValue(traktClientId.nilIfEmpty, forKey: SettingsKeys.traktClientId)
        try? await settings.setValue(traktClientSecret.nilIfEmpty, forKey: SettingsKeys.traktClientSecret)
        do {
            let token = try await traktSyncService.exchangeDeviceCode(
                clientID: traktClientId,
                clientSecret: traktClientSecret,
                deviceCode: deviceCode
            )
            // Persist the token plus its created_at/expires_in so proactive refresh works.
            if let coordinator = appState.traktCoordinator {
                try await coordinator.storeToken(token)
            } else {
                try await settings.setValue(token.accessToken, forKey: SettingsKeys.traktAccessToken)
                try await settings.setValue(token.refreshToken, forKey: SettingsKeys.traktRefreshToken)
            }
            pendingTraktDeviceCode = nil
            traktUserCode = nil
            traktVerificationURL = nil
            traktConnected = await appState.traktCoordinator?.isConnected() ?? true
            statusMessage = "Trakt auth complete."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func disconnectTrakt() async {
        await appState.traktCoordinator?.disconnect()
        traktConnected = false
        pendingTraktDeviceCode = nil
        traktUserCode = nil
        traktVerificationURL = nil
        statusMessage = "Trakt disconnected."
    }

    private func importTraktWatchlist() async {
        guard traktConnected else {
            statusMessage = "Error: Connect Trakt first."
            return
        }
        isImportingTraktWatchlist = true
        defer { isImportingTraktWatchlist = false }
        do {
            let added = try await appState.importTraktWatchlist()
            // Refresh Discover so the imported watchlist items surface immediately.
            if added > 0 {
                await appState.preloadDiscoverCatalog(forceRefresh: true)
            }
            statusMessage = added > 0
                ? "Imported \(added) item(s) from Trakt watchlist."
                : "Trakt watchlist already in sync."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func saveIndexerSettings() async {
        guard let db = appState.databaseManager else {
            statusMessage = "Error: Database not initialized"
            return
        }
        // Persist the current visual order as contiguous priorities.
        reindexPriorities()
        editingIndexerID = nil
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
            statusMessage = "Sources saved."
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }

    private func addIndexerDraft() {
        let baseURL = newIndexerBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !baseURL.isEmpty else { return }

        let config = makeDraftConfig(id: "idx-\(UUID().uuidString)", baseURL: baseURL)

        indexerConfigs.append(config)
        indexerConfigs.sort { $0.priority < $1.priority }
        reindexPriorities()
        newIndexerName = ""
        newIndexerBaseURL = ""
        newIndexerApiKey = ""
        newIndexerCategoryFilter = ""
        newIndexerEndpointPath = defaultEndpointPath(for: newIndexerType)
        newIndexerPriority = 10
        indexerTestStatus = nil
    }

    /// Builds an IndexerConfig from the draft form, zeroing out Torznab-only fields
    /// for Stremio addons (which need only a base URL).
    private func makeDraftConfig(id: String, baseURL: String) -> IndexerConfig {
        let isStremio = newIndexerType == .stremioAddon
        return IndexerConfig(
            id: id,
            type: newIndexerType,
            baseURL: baseURL,
            apiKey: isStremio ? nil : newIndexerApiKey.nilIfEmpty,
            isActive: true,
            displayName: newIndexerName.nilIfEmpty,
            providerSubtype: providerSubtype(for: newIndexerType),
            endpointPath: isStremio ? "" : newIndexerEndpointPath.trimmingCharacters(in: .whitespacesAndNewlines),
            categoryFilter: isStremio ? nil : newIndexerCategoryFilter.nilIfEmpty,
            priority: newIndexerPriority
        )
    }

    private func removeIndexer(_ id: String) {
        indexerConfigs.removeAll { $0.id == id }
        if editingIndexerID == id { editingIndexerID = nil }
        reindexPriorities()
    }

    private func testDraftIndexerConnection() async {
        let baseURL = newIndexerBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !baseURL.isEmpty else { return }
        isTestingIndexer = true
        defer { isTestingIndexer = false }
        let config = makeDraftConfig(id: "test-\(UUID().uuidString)", baseURL: baseURL)
        let success = await IndexerFactory.testConnection(config: config)
        indexerTestStatus = success ? "Connection succeeded." : "Connection failed."
    }

    private func defaultEndpointPath(for type: IndexerConfig.IndexerType) -> String {
        switch type {
        case .jackett: return "/api/v2.0/indexers/all/results/torznab/api"
        case .prowlarr: return "/api/v1/search"
        case .torznab, .zilean: return "/api"
        case .stremioAddon: return ""
        case .builtIn: return ""
        }
    }

    private func providerSubtype(for type: IndexerConfig.IndexerType) -> IndexerConfig.ProviderSubtype {
        switch type {
        case .jackett: return .jackett
        case .prowlarr: return .prowlarr
        case .torznab, .zilean: return .customTorznab
        case .stremioAddon: return .stremioAddon
        case .builtIn: return .builtIn
        }
    }

    /// Whether the draft "Add Source" form should show Torznab-only fields
    /// (endpoint path, category filter, API key). Stremio addons need only a base URL.
    private var draftShowsTorznabFields: Bool {
        newIndexerType != .stremioAddon
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
