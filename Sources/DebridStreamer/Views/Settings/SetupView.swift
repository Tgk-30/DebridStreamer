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
    @State private var step = 1

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 12) {
                Image(systemName: "play.tv.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(.tint)
                Text("Welcome to DebridStreamer")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                Text("Set up your API keys to get started")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 40)
            .padding(.bottom, 32)

            // Steps — using Group+switch instead of TabView to avoid focus issues
            Group {
                switch step {
                case 1: tmdbStep
                case 2: debridStep
                case 3: completeStep
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

    // MARK: - Step 1: TMDB Key

    private var tmdbStep: some View {
        VStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Step 1: TMDB API Key")
                    .font(.title2)
                    .fontWeight(.semibold)
                Text("Required for movie and TV show metadata, posters, and descriptions.")
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
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
                    HStack(spacing: 4) {
                        Image(systemName: valid ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .foregroundStyle(valid ? .green : .red)
                        Text(valid ? "Valid API key!" : (errorMessage ?? "Invalid API key. Please check and try again."))
                            .font(.caption)
                            .foregroundStyle(valid ? .green : .red)
                    }
                }
            }

            HStack {
                Spacer()
                Button("Validate & Continue") {
                    Task { await validateTMDB() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(tmdbKey.trimmingCharacters(in: .whitespaces).isEmpty || isValidating)

                if isValidating {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .padding()
    }

    // MARK: - Step 2: Debrid Key

    private var debridStep: some View {
        VStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Step 2: Real-Debrid Token (Optional)")
                    .font(.title2)
                    .fontWeight(.semibold)
                Text("For streaming torrents via direct HTTPS links. You can also add this later in Settings.")
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
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
                    HStack(spacing: 4) {
                        Image(systemName: status.contains("Error") ? "xmark.circle.fill" : "checkmark.circle.fill")
                            .foregroundStyle(status.contains("Error") ? .red : .green)
                        Text(status)
                            .font(.caption)
                            .foregroundStyle(status.contains("Error") ? .red : .green)
                    }
                }
            }

            HStack {
                Button("Back") { step = 1 }
                Spacer()
                Button("Skip") { step = 3 }
                    .buttonStyle(.bordered)
                Button("Save & Continue") {
                    Task { await saveDebridAndContinue() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(rdToken.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding()
    }

    // MARK: - Step 3: Complete

    private var completeStep: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(.green)

            Text("You're all set!")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Start browsing movies and TV shows on the Discover page.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button("Start Browsing") {
                appState.selectedSidebarItem = .discover
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding()
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
}
