import Testing
import Foundation
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
}
