import Testing
import Foundation
import Security
@testable import DebridStreamer

@Suite("SecretStore Helpers Tests")
struct SecretStoreTests {
    @Test("SecretReference encode/decode round trip")
    func referenceRoundTrip() {
        let encoded = SecretReference.encode(key: "debrid.real_debrid")
        #expect(encoded == "keychain:debrid.real_debrid")
        #expect(SecretReference.decode(encoded) == "debrid.real_debrid")
    }

    @Test("SecretReference decode ignores plaintext values")
    func decodePlaintext() {
        #expect(SecretReference.decode("plain-token") == nil)
    }

    @Test("SecretKey namespaces are stable")
    func keyNamespaces() {
        #expect(SecretKey.setting(SettingsKeys.tmdbApiKey) == "settings.tmdb_api_key")
        #expect(SecretKey.debridToken(service: .premiumize) == "debrid.premiumize")
    }

    @Test("SecretStoreError descriptions expose useful details")
    func errorDescriptions() {
        let unexpected = SecretStoreError.unexpectedStatus(-50, operation: "read")
        let invalid = SecretStoreError.invalidSecretData

        #expect(unexpected.errorDescription == "Keychain read failed with status -50")
        #expect(invalid.errorDescription == "Stored secret data is invalid")
    }

    @Test("KeychainSecretStore round-trips and overwrites values")
    func keychainRoundTrip() async throws {
        let storeService = "com.debridstreamer.tests.secret-store.\(UUID().uuidString)"
        let account = "secret.\(UUID().uuidString)"
        let store = KeychainSecretStore(serviceName: storeService)

        defer { _ = clearLegacySecretKey(serviceName: storeService, key: account) }

        let missing = try await store.getSecret(for: account)
        #expect(missing == nil)

        try await store.setSecret("first", for: account)
        #expect(try await store.getSecret(for: account) == "first")

        try await store.setSecret("second", for: account)
        #expect(try await store.getSecret(for: account) == "second")

        try await store.deleteSecret(for: account)
        #expect(try await store.getSecret(for: account) == nil)
    }

    @Test("KeychainSecretStore treats invalid UTF-8 payload as invalid secret data")
    func keychainRejectsInvalidSecretData() async throws {
        let storeService = "com.debridstreamer.tests.secret-store-invalid.\(UUID().uuidString)"
        let account = "bad.\(UUID().uuidString)"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: storeService,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecAttrSynchronizable as String: false,
            kSecValueData as String: Data([0xFF, 0xFE, 0x00])
        ]
        defer { _ = clearLegacySecretKey(serviceName: storeService, key: account) }

        let writeStatus = SecItemAdd(query as CFDictionary, nil)
        #expect(writeStatus == errSecSuccess)

        let store = KeychainSecretStore(serviceName: storeService)
        do {
            _ = try await store.getSecret(for: account)
            Issue.record("Expected invalid secret data error")
        } catch let error as SecretStoreError {
            #expect(error == .invalidSecretData)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }
}

private func clearLegacySecretKey(serviceName: String, key: String) -> OSStatus {
    SecItemDelete([
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: serviceName,
        kSecAttrAccount as String: key
    ] as CFDictionary)
}
