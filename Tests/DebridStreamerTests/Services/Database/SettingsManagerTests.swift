import Testing
import Foundation
@testable import DebridStreamer

@Suite("SettingsManager Tests")
struct SettingsManagerTests {
    @Test("Get and set generic value")
    func getAndSet() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())

        try await settings.setValue("hello", forKey: "test_key")
        let value = try await settings.getValue(forKey: "test_key")
        #expect(value == "hello")
    }

    @Test("Get nonexistent key returns nil")
    func getNonexistent() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())

        let value = try await settings.getValue(forKey: "does_not_exist")
        #expect(value == nil)
    }

    @Test("Set nil removes value")
    func setNilRemoves() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())

        try await settings.setValue("value", forKey: "key")
        try await settings.setValue(nil, forKey: "key")
        let result = try await settings.getValue(forKey: "key")
        #expect(result == nil)
    }

    @Test("Secret settings store reference in database and raw value in secret store")
    func secretSettingStoresReference() async throws {
        let db = try makeTestDatabase()
        let secretStore = InMemorySecretStore()
        let settings = SettingsManager(database: db, secretStore: secretStore)

        try await settings.setTMDBApiKey("my-tmdb-key-123")

        let storedInDb = try await db.getSetting(key: SettingsKeys.tmdbApiKey)
        #expect(storedInDb?.hasPrefix(SecretReference.keychainPrefix) == true)
        #expect(storedInDb != "my-tmdb-key-123")

        let key = SecretKey.setting(SettingsKeys.tmdbApiKey)
        let secret = await secretStore.rawValue(for: key)
        #expect(secret == "my-tmdb-key-123")
        #expect(try await settings.getTMDBApiKey() == "my-tmdb-key-123")
    }

    @Test("Legacy plaintext secret is migrated on read")
    func legacyPlaintextMigrates() async throws {
        let db = try makeTestDatabase()
        let secretStore = InMemorySecretStore()
        let settings = SettingsManager(database: db, secretStore: secretStore)

        try await db.setSetting(key: SettingsKeys.omdbApiKey, value: "legacy-plaintext-omdb")
        let value = try await settings.getValue(forKey: SettingsKeys.omdbApiKey)
        #expect(value == "legacy-plaintext-omdb")

        let storedInDb = try await db.getSetting(key: SettingsKeys.omdbApiKey)
        #expect(storedInDb?.hasPrefix(SecretReference.keychainPrefix) == true)
        #expect(storedInDb != "legacy-plaintext-omdb")

        let key = SecretKey.setting(SettingsKeys.omdbApiKey)
        let secret = await secretStore.rawValue(for: key)
        #expect(secret == "legacy-plaintext-omdb")
    }

    @Test("Eager legacy secret sweep migrates plaintext without reading the keys")
    func legacySecretSweepMigratesEagerly() async throws {
        let db = try makeTestDatabase()
        let secretStore = InMemorySecretStore()
        let settings = SettingsManager(database: db, secretStore: secretStore)

        // Seed two legacy plaintext secrets directly in the DB (bypassing SettingsManager).
        try await db.setSetting(key: SettingsKeys.omdbApiKey, value: "legacy-omdb")
        try await db.setSetting(key: SettingsKeys.traktClientSecret, value: "legacy-trakt")

        // Run the eager sweep WITHOUT reading either key first.
        try await settings.migrateLegacySecretsIfNeeded()

        // DB rows are now SecretReferences, not the raw plaintext.
        let storedOmdb = try await db.getSetting(key: SettingsKeys.omdbApiKey)
        let storedTrakt = try await db.getSetting(key: SettingsKeys.traktClientSecret)
        #expect(storedOmdb?.hasPrefix(SecretReference.keychainPrefix) == true)
        #expect(storedTrakt?.hasPrefix(SecretReference.keychainPrefix) == true)
        #expect(storedOmdb != "legacy-omdb")
        #expect(storedTrakt != "legacy-trakt")

        // Raw values live in the secret store.
        #expect(await secretStore.rawValue(for: SecretKey.setting(SettingsKeys.omdbApiKey)) == "legacy-omdb")
        #expect(await secretStore.rawValue(for: SecretKey.setting(SettingsKeys.traktClientSecret)) == "legacy-trakt")
    }

    @Test("Legacy secret sweep is idempotent and guarded by a one-time flag")
    func legacySecretSweepIsIdempotent() async throws {
        let db = try makeTestDatabase()
        let secretStore = InMemorySecretStore()
        let settings = SettingsManager(database: db, secretStore: secretStore)

        try await db.setSetting(key: SettingsKeys.omdbApiKey, value: "legacy-omdb")
        try await settings.migrateLegacySecretsIfNeeded()

        // Flag should be set so a second run is a no-op.
        #expect(try await db.getSetting(key: SettingsKeys.legacySecretSweepCompleted) == "true")

        // Simulate a new plaintext secret written AFTER the sweep already ran: because
        // the sweep is gated by the completion flag, it must not re-migrate on a second
        // call (the lazy getValue path still handles late writes).
        try await db.setSetting(key: SettingsKeys.tmdbApiKey, value: "late-plaintext")
        try await settings.migrateLegacySecretsIfNeeded()
        let tmdbAfter = try await db.getSetting(key: SettingsKeys.tmdbApiKey)
        #expect(tmdbAfter == "late-plaintext")

        // The already-migrated key stays a reference and keeps its value.
        #expect(await secretStore.rawValue(for: SecretKey.setting(SettingsKeys.omdbApiKey)) == "legacy-omdb")
    }

    @Test("Concurrent addAIUsage calls do not lose updates")
    func concurrentAIUsageIsAtomic() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())

        await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<50 {
                group.addTask {
                    try await settings.addAIUsage(inputTokens: 1, outputTokens: 2, estimatedCostUSD: 0.001)
                }
            }
        }

        let input = try await settings.getAIUsageTotalInputTokens()
        let output = try await settings.getAIUsageTotalOutputTokens()
        let cost = try await settings.getAIUsageTotalEstimatedCostUSD()

        #expect(input == 50)
        #expect(output == 100)
        #expect(abs(cost - 0.05) < 0.0001)
    }

    @Test("AI secret keys are keychain-backed")
    func aiSecretKeysStoredSecurely() async throws {
        let db = try makeTestDatabase()
        let secretStore = InMemorySecretStore()
        let settings = SettingsManager(database: db, secretStore: secretStore)

        try await settings.setValue("openai-secret", forKey: SettingsKeys.openAIApiKey)
        let dbValue = try await db.getSetting(key: SettingsKeys.openAIApiKey)
        #expect(dbValue?.hasPrefix(SecretReference.keychainPrefix) == true)
        #expect(await secretStore.rawValue(for: SecretKey.setting(SettingsKeys.openAIApiKey)) == "openai-secret")
    }

    @Test("AI model settings persist as non-secret values")
    func aiModelSettingsPersistAsNonSecret() async throws {
        let db = try makeTestDatabase()
        let secretStore = InMemorySecretStore()
        let settings = SettingsManager(database: db, secretStore: secretStore)

        try await settings.setValue("gpt-4.1", forKey: SettingsKeys.openAIModelPreset)
        try await settings.setValue("custom-openai", forKey: SettingsKeys.openAIModelCustom)
        try await settings.setValue("claude-3-7-sonnet-latest", forKey: SettingsKeys.anthropicModelPreset)
        try await settings.setValue("custom-anthropic", forKey: SettingsKeys.anthropicModelCustom)

        let storedOpenAIPreset = try await db.getSetting(key: SettingsKeys.openAIModelPreset)
        let storedOpenAICustom = try await db.getSetting(key: SettingsKeys.openAIModelCustom)
        let storedAnthropicPreset = try await db.getSetting(key: SettingsKeys.anthropicModelPreset)
        let storedAnthropicCustom = try await db.getSetting(key: SettingsKeys.anthropicModelCustom)

        #expect(storedOpenAIPreset == "gpt-4.1")
        #expect(storedOpenAICustom == "custom-openai")
        #expect(storedAnthropicPreset == "claude-3-7-sonnet-latest")
        #expect(storedAnthropicCustom == "custom-anthropic")
    }

    @Test("Feedback scale mode defaults to like/dislike and round-trips")
    func feedbackScaleModeRoundTrip() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())

        let defaultMode = try await settings.getFeedbackScaleMode()
        #expect(defaultMode == .likeDislike)

        try await settings.setFeedbackScaleMode(.scale1to100)
        let storedMode = try await settings.getFeedbackScaleMode()
        #expect(storedMode == .scale1to100)

        let raw = try await db.getSetting(key: SettingsKeys.feedbackScaleMode)
        #expect(raw == FeedbackScaleMode.scale1to100.rawValue)
    }

    @Test("AI usage counters accumulate token and estimated cost totals")
    func aiUsageCountersAccumulate() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())

        try await settings.addAIUsage(inputTokens: 120, outputTokens: 80, estimatedCostUSD: 0.0042)
        try await settings.addAIUsage(inputTokens: 30, outputTokens: 20, estimatedCostUSD: 0.0011)

        let input = try await settings.getAIUsageTotalInputTokens()
        let output = try await settings.getAIUsageTotalOutputTokens()
        let cost = try await settings.getAIUsageTotalEstimatedCostUSD()

        #expect(input == 150)
        #expect(output == 100)
        #expect(abs(cost - 0.0053) < 0.000001)
    }

    @Test("Clearing secret setting removes keychain and database entries")
    func clearingSecretDeletesBackingData() async throws {
        let db = try makeTestDatabase()
        let secretStore = InMemorySecretStore()
        let settings = SettingsManager(database: db, secretStore: secretStore)

        try await settings.setTMDBApiKey("temporary")
        try await settings.setValue(nil, forKey: SettingsKeys.tmdbApiKey)

        let dbValue = try await db.getSetting(key: SettingsKeys.tmdbApiKey)
        #expect(dbValue == nil)
        let secret = await secretStore.rawValue(for: SecretKey.setting(SettingsKeys.tmdbApiKey))
        #expect(secret == nil)
    }

    @Test("Preferred quality defaults to 1080p")
    func preferredQualityDefault() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let quality = try await settings.getPreferredQuality()
        #expect(quality == .hd1080p)
    }

    @Test("Preferred quality set and get")
    func preferredQualitySetGet() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())

        try await settings.setPreferredQuality(.uhd4k)
        let quality = try await settings.getPreferredQuality()
        #expect(quality == .uhd4k)

        try await settings.setPreferredQuality(.hd720p)
        let quality2 = try await settings.getPreferredQuality()
        #expect(quality2 == .hd720p)
    }

    @Test("Preferred quality with invalid raw value returns default")
    func preferredQualityInvalidRaw() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())

        try await settings.setValue("garbage", forKey: SettingsKeys.preferredQuality)
        let quality = try await settings.getPreferredQuality()
        #expect(quality == .hd1080p)
    }

    @Test("Subtitle language defaults to en")
    func subtitleLanguageDefault() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let lang = try await settings.getSubtitleLanguage()
        #expect(lang == "en")
    }

    @Test("Subtitle language set and get")
    func subtitleLanguageSetGet() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())

        try await settings.setSubtitleLanguage("fr")
        let lang = try await settings.getSubtitleLanguage()
        #expect(lang == "fr")
    }

    @Test("Preferred player defaults to auto")
    func preferredPlayerDefault() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let preferred = try await settings.getPreferredPlayer()
        #expect(preferred == .auto)
    }

    @Test("Preferred player set and get")
    func preferredPlayerSetGet() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())

        try await settings.setPreferredPlayer(.vlc)
        let preferred = try await settings.getPreferredPlayer()
        #expect(preferred == .vlc)
    }

    @Test("Internal player backend defaults to automatic")
    func internalPlayerBackendDefault() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let backend = try await settings.getInternalPlayerBackend()
        #expect(backend == .automatic)
    }

    @Test("Internal player backend set and get")
    func internalPlayerBackendSetGet() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())

        try await settings.setInternalPlayerBackend(.vlc)
        let backend = try await settings.getInternalPlayerBackend()
        #expect(backend == .vlc)
    }

    @Test("All settings keys are distinct")
    func settingsKeysDistinct() {
        let keys = [
            SettingsKeys.tmdbApiKey,
            SettingsKeys.omdbApiKey,
            SettingsKeys.preferredQuality,
            SettingsKeys.subtitleLanguage,
            SettingsKeys.autoPlayNext,
            SettingsKeys.defaultDebridService,
            SettingsKeys.preferredPlayer,
            SettingsKeys.internalPlayerBackend,
            SettingsKeys.openAIApiKey,
            SettingsKeys.anthropicApiKey,
            SettingsKeys.openAIModelPreset,
            SettingsKeys.openAIModelCustom,
            SettingsKeys.anthropicModelPreset,
            SettingsKeys.anthropicModelCustom,
            SettingsKeys.ollamaEndpoint,
            SettingsKeys.aiCompareMode,
            SettingsKeys.traktClientId,
            SettingsKeys.traktClientSecret,
            SettingsKeys.traktAccessToken,
            SettingsKeys.traktRefreshToken,
            SettingsKeys.personalizationEnabled,
            SettingsKeys.discoverAICurationOnLaunch,
            SettingsKeys.favoriteGenres,
            SettingsKeys.avoidGenres,
            SettingsKeys.preferredEras,
            SettingsKeys.toneMoodTags,
            SettingsKeys.currentVibeNotes,
            SettingsKeys.recencySensitivity,
            SettingsKeys.onboardingTastePromptShown,
            SettingsKeys.feedbackScaleMode,
            SettingsKeys.aiUsageTotalInputTokens,
            SettingsKeys.aiUsageTotalOutputTokens,
            SettingsKeys.aiUsageTotalEstimatedCostUSD,
            SettingsKeys.legacySecretSweepCompleted
        ]
        let uniqueKeys = Set(keys)
        #expect(uniqueKeys.count == keys.count)
    }
}
