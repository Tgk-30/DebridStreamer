import SwiftUI

/// First-run setup view shown when no TMDB API key is configured.
struct SetupView: View {
    @Environment(AppState.self) private var appState
    private let secretStore = KeychainSecretStore()
    @State private var tmdbKey = ""
    @State private var rdToken = ""
    @State private var isValidating = false
    @State private var tmdbValid: Bool?
    @State private var errorMessage: String?
    @State private var rdSaveStatus: String?
    @State private var tasteSaveStatus: String?
    @State private var step = 1

    @State private var personalizationEnabled = false
    @State private var aiCurationOnLaunch = false
    @State private var favoriteGenres = ""
    @State private var avoidGenres = ""
    @State private var preferredEras = ""
    @State private var currentVibe = ""
    @State private var recencySensitivity = 0.7
    @State private var feedbackScaleMode: FeedbackScaleMode = .likeDislike

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            AppTheme.auroraGlow

            VStack(spacing: 0) {
                // Header
                VStack(spacing: AppTheme.Spacing.md) {
                    Image(systemName: "play.tv.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(AppTheme.heroGradient)
                    Text("Welcome to DebridStreamer")
                        .font(.largeTitle)
                        .fontWeight(.bold)
                    Text("Set up your API keys to get started")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, AppTheme.Spacing.xxxl)
                .padding(.bottom, AppTheme.Spacing.xxl)

                // Steps - using Group+switch instead of TabView to avoid focus issues
                Group {
                    switch step {
                    case 1: tmdbStep
                    case 2: debridStep
                    case 3: tasteStep
                    case 4: completeStep
                    default: tmdbStep
                    }
                }
                .frame(maxWidth: 500)
                .animation(.easeInOut(duration: 0.2), value: step)

                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding()
        }
    }

    // MARK: - Step 1: TMDB Key

    private var tmdbStep: some View {
        VStack(spacing: AppTheme.Spacing.xl) {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                Text("Step 1: TMDB API Key")
                    .font(.title2)
                    .fontWeight(.semibold)
                Text("Required for movie and TV show metadata, posters, and descriptions.")
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                NativeSecureField(
                    placeholder: "Enter your TMDB API key",
                    text: $tmdbKey,
                    onSubmit: { Task { await validateTMDB() } }
                )

                HStack {
                    Text("Get a free key at")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Link("themoviedb.org", destination: URL(string: "https://www.themoviedb.org/settings/api")!)
                        .font(.caption)
                }

                if let valid = tmdbValid {
                    HStack(spacing: AppTheme.Spacing.xs) {
                        Image(systemName: valid ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .foregroundStyle(valid ? AppTheme.success : AppTheme.danger)
                        Text(valid ? "Valid API key!" : (errorMessage ?? "Invalid API key. Please check and try again."))
                            .font(.caption)
                            .foregroundStyle(valid ? AppTheme.success : AppTheme.danger)
                    }
                }
            }

            HStack {
                Spacer()
                Button("Validate & Continue") {
                    Task { await validateTMDB() }
                }
                .buttonStyle(.glassProminent)
                .disabled(tmdbKey.trimmingCharacters(in: .whitespaces).isEmpty || isValidating)

                if isValidating {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .padding(AppTheme.Spacing.xl)
        .glassCard(radius: AppTheme.Radius.lg)
    }

    // MARK: - Step 2: Debrid Key

    private var debridStep: some View {
        VStack(spacing: AppTheme.Spacing.xl) {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                Text("Step 2: Real-Debrid Token (Optional)")
                    .font(.title2)
                    .fontWeight(.semibold)
                Text("For streaming torrents via direct HTTPS links. You can also add this later in Settings.")
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                NativeSecureField(
                    placeholder: "Real-Debrid API token (optional)",
                    text: $rdToken,
                    onSubmit: { Task { await saveDebridAndContinue() } }
                )

                HStack {
                    Text("Get your token at")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Link("real-debrid.com/apitoken", destination: URL(string: "https://real-debrid.com/apitoken")!)
                        .font(.caption)
                }

                if let status = rdSaveStatus {
                    HStack(spacing: AppTheme.Spacing.xs) {
                        Image(systemName: status.contains("Error") ? "xmark.circle.fill" : "checkmark.circle.fill")
                            .foregroundStyle(status.contains("Error") ? AppTheme.danger : AppTheme.success)
                        Text(status)
                            .font(.caption)
                            .foregroundStyle(status.contains("Error") ? AppTheme.danger : AppTheme.success)
                    }
                }
            }

            HStack {
                Button("Back") { step = 1 }
                    .buttonStyle(.glass)
                Spacer()
                Button("Skip") { step = 3 }
                    .buttonStyle(.glass)
                Button("Save & Continue") {
                    Task { await saveDebridAndContinue() }
                }
                .buttonStyle(.glassProminent)
                .disabled(rdToken.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(AppTheme.Spacing.xl)
        .glassCard(radius: AppTheme.Radius.lg)
    }

    // MARK: - Step 3: Personalization

    private var tasteStep: some View {
        VStack(spacing: AppTheme.Spacing.lg) {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                Text("Step 3: Personalize Recommendations")
                    .font(.title2)
                    .fontWeight(.semibold)
                Text("Optional and local-only. You can edit this later in Settings → Personalization.")
                    .foregroundStyle(.secondary)
            }

            Toggle("Enable personalized AI", isOn: $personalizationEnabled)
            Toggle("Generate AI-curated Discover on launch", isOn: $aiCurationOnLaunch)
                .disabled(!personalizationEnabled)
            Picker("Feedback mode", selection: $feedbackScaleMode) {
                ForEach(FeedbackScaleMode.allCases) { mode in
                    Text(mode.displayName).tag(mode)
                }
            }
            .disabled(!personalizationEnabled)

            Group {
                TextField("Favorite genres (comma separated)", text: $favoriteGenres)
                TextField("Avoid genres (comma separated)", text: $avoidGenres)
                TextField("Preferred eras (e.g. 90s, 2000s)", text: $preferredEras)
                TextField("Current vibe notes", text: $currentVibe)
            }
            .textFieldStyle(.roundedBorder)
            .disabled(!personalizationEnabled)

            VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                HStack {
                    Text("Recency sensitivity")
                    Spacer()
                    Text(String(format: "%.2f", recencySensitivity))
                        .foregroundStyle(.secondary)
                }
                Slider(value: $recencySensitivity, in: 0...1)
            }
            .disabled(!personalizationEnabled)

            if let tasteSaveStatus {
                Text(tasteSaveStatus)
                    .font(.caption)
                    .foregroundStyle(tasteSaveStatus.contains("Error") ? AppTheme.danger : AppTheme.success)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack {
                Button("Back") { step = 2 }
                    .buttonStyle(.glass)
                Spacer()
                Button("Skip") {
                    Task {
                        personalizationEnabled = false
                        await saveTasteAndContinue()
                    }
                }
                .buttonStyle(.glass)
                Button("Save & Continue") {
                    Task { await saveTasteAndContinue() }
                }
                .buttonStyle(.glassProminent)
            }
        }
        .padding(AppTheme.Spacing.xl)
        .glassCard(radius: AppTheme.Radius.lg)
    }

    // MARK: - Step 3: Complete

    private var completeStep: some View {
        VStack(spacing: AppTheme.Spacing.xl) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(AppTheme.success)

            Text("You're all set!")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Start browsing movies and TV shows on the Discover page.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button("Start Browsing") {
                appState.selectedSidebarItem = .discover
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
        .padding(AppTheme.Spacing.xl)
        .glassCard(radius: AppTheme.Radius.lg)
    }

    // MARK: - Actions

    private func validateTMDB() async {
        isValidating = true
        defer { isValidating = false }

        let testService = TMDBService(apiKey: tmdbKey.trimmingCharacters(in: .whitespaces))
        do {
            // Try fetching trending to validate the key
            _ = try await testService.getTrending(type: .movie, timeWindow: .day, page: 1)
            tmdbValid = true
            errorMessage = nil

            // Save the key
            if let settings = appState.settingsManager {
                try await settings.setTMDBApiKey(tmdbKey.trimmingCharacters(in: .whitespaces))
            }
            appState.updateTMDBService(apiKey: tmdbKey.trimmingCharacters(in: .whitespaces))

            // Move to next step
            try? await Task.sleep(for: .milliseconds(500))
            step = 2
        } catch {
            tmdbValid = false
            errorMessage = error.localizedDescription
        }
    }

    private func saveDebridAndContinue() async {
        let token = rdToken.trimmingCharacters(in: .whitespaces)
        guard !token.isEmpty else {
            step = 3
            return
        }

        guard let db = appState.databaseManager else {
            rdSaveStatus = "Error: Database not initialized"
            return
        }

        let config = DebridConfig(
            id: DebridServiceType.realDebrid.rawValue,
            service: .realDebrid,
            apiToken: SecretReference.encode(key: SecretKey.debridToken(service: .realDebrid)),
            isActive: true,
            priority: 0
        )

        do {
            try await secretStore.setSecret(token, for: SecretKey.debridToken(service: .realDebrid))
            try await db.saveDebridConfig(config)

            // Verify it was saved
            let saved = try await db.fetchAllDebridConfigs()
            if saved.contains(where: { $0.service == .realDebrid }) {
                rdSaveStatus = "Real-Debrid token saved!"
                // Reload debrid services so they're immediately available
                await appState.reloadDebridServices()
                try? await Task.sleep(for: .milliseconds(500))
                step = 3
            } else {
                rdSaveStatus = "Error: Token was not saved. Please try again."
            }
        } catch {
            rdSaveStatus = "Error: \(error.localizedDescription)"
        }
    }

    private func saveTasteAndContinue() async {
        guard let settings = appState.settingsManager else {
            tasteSaveStatus = "Error: Settings unavailable."
            return
        }

        do {
            try await settings.setPersonalizationEnabled(personalizationEnabled)
            try await settings.setDiscoverAICurationOnLaunchEnabled(personalizationEnabled && aiCurationOnLaunch)
            try await settings.setValue(favoriteGenres.nilIfEmpty, forKey: SettingsKeys.favoriteGenres)
            try await settings.setValue(avoidGenres.nilIfEmpty, forKey: SettingsKeys.avoidGenres)
            try await settings.setValue(preferredEras.nilIfEmpty, forKey: SettingsKeys.preferredEras)
            try await settings.setValue(currentVibe.nilIfEmpty, forKey: SettingsKeys.currentVibeNotes)
            try await settings.setValue(String(recencySensitivity), forKey: SettingsKeys.recencySensitivity)
            try await settings.setFeedbackScaleMode(personalizationEnabled ? feedbackScaleMode : .likeDislike)
            try await settings.setOnboardingTastePromptShown(true)

            if personalizationEnabled, let db = appState.databaseManager {
                let profile = UserTasteProfile(
                    userId: "default",
                    likedGenres: favoriteGenres.commaSeparated,
                    dislikedGenres: avoidGenres.commaSeparated,
                    preferredDecades: preferredEras.commaSeparated.compactMap {
                        Int($0.filter(\.isNumber))
                    },
                    preferredLanguages: [],
                    updatedAt: Date()
                )
                try await db.saveUserTasteProfile(profile)
                await appState.preloadDiscoverAICuration(forceRefresh: true)
            }

            tasteSaveStatus = "Personalization saved."
            step = 4
        } catch {
            tasteSaveStatus = "Error: \(error.localizedDescription)"
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    var commaSeparated: [String] {
        split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}
