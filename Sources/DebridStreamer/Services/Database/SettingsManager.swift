import Foundation

/// Convenience wrapper around DatabaseManager for app settings.
actor SettingsManager {
    private let database: DatabaseManager
    private let secretStore: any SecretStore
    private let secretKeys: Set<String> = [
        SettingsKeys.tmdbApiKey,
        SettingsKeys.omdbApiKey,
        SettingsKeys.openAIApiKey,
        SettingsKeys.anthropicApiKey,
        SettingsKeys.traktClientId,
        SettingsKeys.traktClientSecret,
        SettingsKeys.traktAccessToken,
        SettingsKeys.traktRefreshToken
    ]

    init(database: DatabaseManager, secretStore: any SecretStore = KeychainSecretStore()) {
        self.database = database
        self.secretStore = secretStore
    }

    func getValue(forKey key: String) async throws -> String? {
        guard let stored = try await database.getSetting(key: key) else {
            return nil
        }

        guard secretKeys.contains(key) else {
            return stored
        }

        if let secretKey = SecretReference.decode(stored) {
            return try await secretStore.getSecret(for: secretKey)
        }

        // Legacy plaintext setting. Migrate it to keychain-backed storage.
        let migratedKey = SecretKey.setting(key)
        try await secretStore.setSecret(stored, for: migratedKey)
        try await database.setSetting(key: key, value: SecretReference.encode(key: migratedKey))
        return stored
    }

    func setValue(_ value: String?, forKey key: String) async throws {
        guard secretKeys.contains(key) else {
            try await database.setSetting(key: key, value: value)
            return
        }

        let secretKey = SecretKey.setting(key)
        if let value, !value.isEmpty {
            try await secretStore.setSecret(value, for: secretKey)
            try await database.setSetting(key: key, value: SecretReference.encode(key: secretKey))
        } else {
            try await secretStore.deleteSecret(for: secretKey)
            try await database.setSetting(key: key, value: nil)
        }
    }

    // MARK: - Typed Accessors

    func getTMDBApiKey() async throws -> String? {
        try await getValue(forKey: SettingsKeys.tmdbApiKey)
    }

    func setTMDBApiKey(_ key: String) async throws {
        try await setValue(key, forKey: SettingsKeys.tmdbApiKey)
    }

    func getPreferredQuality() async throws -> VideoQuality {
        guard let raw = try await getValue(forKey: SettingsKeys.preferredQuality),
              let quality = VideoQuality(rawValue: raw) else {
            return .hd1080p
        }
        return quality
    }

    func setPreferredQuality(_ quality: VideoQuality) async throws {
        try await setValue(quality.rawValue, forKey: SettingsKeys.preferredQuality)
    }

    func getSubtitleLanguage() async throws -> String {
        try await getValue(forKey: SettingsKeys.subtitleLanguage) ?? "en"
    }

    func setSubtitleLanguage(_ lang: String) async throws {
        try await setValue(lang, forKey: SettingsKeys.subtitleLanguage)
    }

    func getPreferredPlayer() async throws -> PreferredPlayer {
        guard let raw = try await getValue(forKey: SettingsKeys.preferredPlayer),
              let preferred = PreferredPlayer(rawValue: raw) else {
            return .auto
        }
        return preferred
    }

    func setPreferredPlayer(_ player: PreferredPlayer) async throws {
        try await setValue(player.rawValue, forKey: SettingsKeys.preferredPlayer)
    }

    func getInternalPlayerBackend() async throws -> InternalPlayerBackend {
        guard let raw = try await getValue(forKey: SettingsKeys.internalPlayerBackend),
              let backend = InternalPlayerBackend(rawValue: raw) else {
            return .automatic
        }
        return backend
    }

    func setInternalPlayerBackend(_ backend: InternalPlayerBackend) async throws {
        try await setValue(backend.rawValue, forKey: SettingsKeys.internalPlayerBackend)
    }
}

/// Constants for settings keys.
enum SettingsKeys {
    static let tmdbApiKey = "tmdb_api_key"
    static let omdbApiKey = "omdb_api_key"
    static let preferredQuality = "preferred_quality"
    static let subtitleLanguage = "subtitle_language"
    static let autoPlayNext = "auto_play_next"
    static let defaultDebridService = "default_debrid_service"
    static let preferredPlayer = "preferred_player"
    static let internalPlayerBackend = "internal_player_backend"

    static let openAIApiKey = "openai_api_key"
    static let anthropicApiKey = "anthropic_api_key"
    static let ollamaEndpoint = "ollama_endpoint"
    static let aiCompareMode = "ai_compare_mode"

    static let traktClientId = "trakt_client_id"
    static let traktClientSecret = "trakt_client_secret"
    static let traktAccessToken = "trakt_access_token"
    static let traktRefreshToken = "trakt_refresh_token"

    static let personalizationEnabled = "personalization_enabled"
    static let discoverAICurationOnLaunch = "discover_ai_curation_on_launch"
    static let favoriteGenres = "favorite_genres"
    static let avoidGenres = "avoid_genres"
    static let preferredEras = "preferred_eras"
    static let toneMoodTags = "tone_mood_tags"
    static let currentVibeNotes = "current_vibe_notes"
    static let recencySensitivity = "recency_sensitivity"
    static let onboardingTastePromptShown = "onboarding_taste_prompt_shown"
}

extension SettingsManager {
    func isPersonalizationEnabled() async throws -> Bool {
        (try await getValue(forKey: SettingsKeys.personalizationEnabled)) == "true"
    }

    func setPersonalizationEnabled(_ enabled: Bool) async throws {
        try await setValue(enabled ? "true" : "false", forKey: SettingsKeys.personalizationEnabled)
    }

    func isDiscoverAICurationOnLaunchEnabled() async throws -> Bool {
        (try await getValue(forKey: SettingsKeys.discoverAICurationOnLaunch)) == "true"
    }

    func setDiscoverAICurationOnLaunchEnabled(_ enabled: Bool) async throws {
        try await setValue(enabled ? "true" : "false", forKey: SettingsKeys.discoverAICurationOnLaunch)
    }
}
