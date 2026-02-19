import Foundation

/// Protocol for all debrid services (Real-Debrid, AllDebrid, Premiumize, TorBox).
protocol DebridServiceProtocol: Sendable {
    /// The service type identifier.
    var serviceType: DebridServiceType { get }

    /// Check which torrent hashes are instantly available (cached) on the service.
    /// Returns a dictionary of hash -> CacheStatus.
    func checkCache(hashes: [String]) async throws -> [String: CacheStatus]

    /// Add a magnet link to the debrid service for downloading.
    /// Returns a torrent/transfer ID.
    func addMagnet(hash: String) async throws -> String

    /// Select specific files from a torrent for download.
    func selectFiles(torrentId: String, fileIds: [Int]) async throws

    /// Get a direct streaming URL for a torrent.
    func getStreamURL(torrentId: String) async throws -> StreamInfo

    /// Unrestrict a hosted link to a direct download URL.
    func unrestrict(link: String) async throws -> URL

    /// Verify the API token is valid.
    func validateToken() async throws -> Bool

    /// Get user account info (for display in settings).
    func getAccountInfo() async throws -> DebridAccountInfo
}

/// Account info for display purposes.
struct DebridAccountInfo: Sendable {
    var username: String
    var email: String?
    var premiumExpiry: Date?
    var isPremium: Bool
    var points: Int?

    var expiryString: String? {
        guard let expiry = premiumExpiry else { return nil }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return formatter.string(from: expiry)
    }
}

/// Errors common to debrid services.
enum DebridError: LocalizedError, Equatable {
    case invalidToken
    case expired
    case rateLimited
    case torrentNotFound(String)
    case noFilesAvailable
    case downloadFailed(String)
    case httpError(Int, String)
    case networkError(String)

    var errorDescription: String? {
        switch self {
        case .invalidToken: return "Invalid API token"
        case .expired: return "Premium subscription expired"
        case .rateLimited: return "Rate limit exceeded. Try again shortly."
        case .torrentNotFound(let id): return "Torrent not found: \(id)"
        case .noFilesAvailable: return "No downloadable files found"
        case .downloadFailed(let msg): return "Download failed: \(msg)"
        case .httpError(let code, let msg): return "HTTP \(code): \(msg)"
        case .networkError(let msg): return "Network error: \(msg)"
        }
    }
}
