import Foundation
import Security

/// Abstraction for storing and retrieving sensitive values.
protocol SecretStore: Sendable {
    func setSecret(_ secret: String, for key: String) async throws
    func getSecret(for key: String) async throws -> String?
    func deleteSecret(for key: String) async throws
}

/// Errors for secret storage operations.
enum SecretStoreError: LocalizedError, Equatable {
    case unexpectedStatus(OSStatus, operation: String)
    case invalidSecretData

    var errorDescription: String? {
        switch self {
        case .unexpectedStatus(let status, let operation):
            return "Keychain \(operation) failed with status \(status)"
        case .invalidSecretData:
            return "Stored secret data is invalid"
        }
    }
}

/// Keychain-backed implementation for storing app secrets.
actor KeychainSecretStore: SecretStore {
    private let serviceName: String

    init(serviceName: String = "com.debridstreamer.credentials") {
        self.serviceName = serviceName
    }

    func setSecret(_ secret: String, for key: String) async throws {
        let encoded = Data(secret.utf8)
        let query = baseQuery(for: key)
        let update: [String: Any] = [kSecValueData as String: encoded]

        let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        if updateStatus != errSecItemNotFound {
            throw SecretStoreError.unexpectedStatus(updateStatus, operation: "update")
        }

        var addQuery = query
        addQuery[kSecValueData as String] = encoded
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw SecretStoreError.unexpectedStatus(addStatus, operation: "add")
        }
    }

    func getSecret(for key: String) async throws -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw SecretStoreError.unexpectedStatus(status, operation: "read")
        }
        guard let data = result as? Data, let secret = String(data: data, encoding: .utf8) else {
            throw SecretStoreError.invalidSecretData
        }
        return secret
    }

    func deleteSecret(for key: String) async throws {
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecretStoreError.unexpectedStatus(status, operation: "delete")
        }
    }

    private func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key
        ]
    }
}

/// Shared conventions for serializing secret references in persistent stores.
enum SecretReference {
    static let keychainPrefix = "keychain:"

    static func encode(key: String) -> String {
        "\(keychainPrefix)\(key)"
    }

    static func decode(_ storedValue: String) -> String? {
        guard storedValue.hasPrefix(keychainPrefix) else { return nil }
        return String(storedValue.dropFirst(keychainPrefix.count))
    }
}

/// Canonical key names for secrets.
enum SecretKey {
    static func setting(_ key: String) -> String {
        "settings.\(key)"
    }

    static func debridToken(service: DebridServiceType) -> String {
        "debrid.\(service.rawValue)"
    }
}
