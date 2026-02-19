import Foundation
@testable import DebridStreamer

actor InMemorySecretStore: SecretStore {
    private var storage: [String: String] = [:]

    func setSecret(_ secret: String, for key: String) async throws {
        storage[key] = secret
    }

    func getSecret(for key: String) async throws -> String? {
        storage[key]
    }

    func deleteSecret(for key: String) async throws {
        storage.removeValue(forKey: key)
    }

    func rawValue(for key: String) -> String? {
        storage[key]
    }
}
