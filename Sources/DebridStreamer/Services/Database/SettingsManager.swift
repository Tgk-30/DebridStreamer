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

    /// Eagerly move any lingering plaintext secret values into the secret store.
    ///
    /// `getValue` migrates a legacy plaintext secret to the keychain only when the
    /// value is next read, so an API key written by an older build can sit in
    /// `app_settings` as plaintext indefinitely. This sweep iterates every known
    /// secret key once at startup and migrates any value that is not already a
    /// `SecretReference`, so plaintext secrets do not linger. It is idempotent
    /// (already-encoded references are skipped) and guarded by a one-time flag so it
    /// does not re-run on every launch.
    func migrateLegacySecretsIfNeeded() async throws {
        if (try await database.getSetting(key: SettingsKeys.legacySecretSweepCompleted)) == "true" {
            return
        }

        for key in secretKeys {
            guard let stored = try await database.getSetting(key: key) else { continue }
            // Already a keychain reference — nothing to migrate.
            if SecretReference.decode(stored) != nil { continue }

            let migratedKey = SecretKey.setting(key)
            try await secretStore.setSecret(stored, for: migratedKey)
            try await database.setSetting(key: key, value: SecretReference.encode(key: migratedKey))
        }

        try await database.setSetting(key: SettingsKeys.legacySecretSweepCompleted, value: "true")
    }

    // MARK: - Typed Accessors

    func getTMDBApiKey() async throws -> String? {
        try await getValue(forKey: SettingsKeys.tmdbApiKey)
    }

    func setTMDBApiKey(_ key: String) async throws {
        try await setValue(key, forKey: SettingsKeys.tmdbApiKey)
    }

    func getOMDBApiKey() async throws -> String? {
        try await getValue(forKey: SettingsKeys.omdbApiKey)
    }

    func setOMDBApiKey(_ key: String) async throws {
        try await setValue(key, forKey: SettingsKeys.omdbApiKey)
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

    func getAIUsageTotalInputTokens() async throws -> Int {
        Int(try await getValue(forKey: SettingsKeys.aiUsageTotalInputTokens) ?? "") ?? 0
    }

    func getAIUsageTotalOutputTokens() async throws -> Int {
        Int(try await getValue(forKey: SettingsKeys.aiUsageTotalOutputTokens) ?? "") ?? 0
    }

    func getAIUsageTotalEstimatedCostUSD() async throws -> Double {
        Double(try await getValue(forKey: SettingsKeys.aiUsageTotalEstimatedCostUSD) ?? "") ?? 0
    }

    func addAIUsage(
        inputTokens: Int?,
        outputTokens: Int?,
        estimatedCostUSD: Double?
    ) async throws {
        // The three usage keys are plain (non-secret) settings, so route the
        // read-modify-write through a single DatabaseManager write transaction.
        // This makes the increment atomic and avoids the lost-update race that a
        // multi-await read-then-write sequence on this actor would otherwise allow.
        _ = try await database.incrementAIUsage(
            inputKey: SettingsKeys.aiUsageTotalInputTokens,
            outputKey: SettingsKeys.aiUsageTotalOutputTokens,
            costKey: SettingsKeys.aiUsageTotalEstimatedCostUSD,
            inputDelta: inputTokens ?? 0,
            outputDelta: outputTokens ?? 0,
            costDelta: estimatedCostUSD ?? 0
        )
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
    static let openAIModelPreset = "openai_model_preset"
    static let openAIModelCustom = "openai_model_custom"
    static let anthropicModelPreset = "anthropic_model_preset"
    static let anthropicModelCustom = "anthropic_model_custom"
    static let ollamaEndpoint = "ollama_endpoint"
    static let aiCompareMode = "ai_compare_mode"
    static let aiUsageTotalInputTokens = "ai_usage_total_input_tokens"
    static let aiUsageTotalOutputTokens = "ai_usage_total_output_tokens"
    static let aiUsageTotalEstimatedCostUSD = "ai_usage_total_estimated_cost_usd"

    static let traktClientId = "trakt_client_id"
    static let traktClientSecret = "trakt_client_secret"
    static let traktAccessToken = "trakt_access_token"
    static let traktRefreshToken = "trakt_refresh_token"
    /// Unix-seconds timestamp the current Trakt token was issued at (`created_at`).
    static let traktTokenCreatedAt = "trakt_token_created_at"
    /// Lifetime in seconds of the current Trakt token (`expires_in`).
    static let traktTokenExpiresIn = "trakt_token_expires_in"

    static let personalizationEnabled = "personalization_enabled"
    static let discoverAICurationOnLaunch = "discover_ai_curation_on_launch"
    static let favoriteGenres = "favorite_genres"
    static let avoidGenres = "avoid_genres"
    static let preferredEras = "preferred_eras"
    static let toneMoodTags = "tone_mood_tags"
    static let currentVibeNotes = "current_vibe_notes"
    static let recencySensitivity = "recency_sensitivity"
    static let onboardingTastePromptShown = "onboarding_taste_prompt_shown"
    static let feedbackScaleMode = "feedback_scale_mode"

    static let legacySecretSweepCompleted = "legacy_secret_sweep_completed"
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

    func wasOnboardingTastePromptShown() async throws -> Bool {
        (try await getValue(forKey: SettingsKeys.onboardingTastePromptShown)) == "true"
    }

    func setOnboardingTastePromptShown(_ shown: Bool) async throws {
        try await setValue(shown ? "true" : "false", forKey: SettingsKeys.onboardingTastePromptShown)
    }

    func getFeedbackScaleMode() async throws -> FeedbackScaleMode {
        guard let raw = try await getValue(forKey: SettingsKeys.feedbackScaleMode),
              let mode = FeedbackScaleMode(rawValue: raw) else {
            return .likeDislike
        }
        return mode
    }

    func setFeedbackScaleMode(_ mode: FeedbackScaleMode) async throws {
        try await setValue(mode.rawValue, forKey: SettingsKeys.feedbackScaleMode)
    }
}
