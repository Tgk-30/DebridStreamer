import Foundation
import GRDB

/// Supported debrid service types.
enum DebridServiceType: String, Codable, Sendable, CaseIterable {
    case realDebrid = "real_debrid"
    case allDebrid = "all_debrid"
    case premiumize = "premiumize"
    case torBox = "torbox"

    var displayName: String {
        switch self {
        case .realDebrid: return "Real-Debrid"
        case .allDebrid: return "AllDebrid"
        case .premiumize: return "Premiumize"
        case .torBox: return "TorBox"
        }
    }

    /// Short two-letter code used in compact badges (e.g. the cached "Instant" pill).
    var shortCode: String {
        switch self {
        case .realDebrid: return "RD"
        case .allDebrid: return "AD"
        case .premiumize: return "PM"
        case .torBox: return "TB"
        }
    }

    var baseURL: String {
        switch self {
        case .realDebrid: return "https://api.real-debrid.com/rest/1.0"
        case .allDebrid: return "https://api.alldebrid.com/v4"
        case .premiumize: return "https://www.premiumize.me/api"
        case .torBox: return "https://api.torbox.app/v1/api"
        }
    }
}

/// User's debrid service configuration stored in the database.
struct DebridConfig: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "debrid_configs"

    var id: String
    var service: DebridServiceType
    var apiToken: String         // Reference to keychain entry
    var isActive: Bool
    var priority: Int            // Lower = higher priority

    enum Columns: String, ColumnExpression {
        case id, service, apiToken, isActive, priority
    }

    func encode(to container: inout PersistenceContainer) {
        container[Columns.id] = id
        container[Columns.service] = service.rawValue
        container[Columns.apiToken] = apiToken
        container[Columns.isActive] = isActive
        container[Columns.priority] = priority
    }

    init(row: Row) throws {
        id = row[Columns.id]
        service = DebridServiceType(rawValue: row[Columns.service] as String) ?? .realDebrid
        apiToken = row[Columns.apiToken]
        isActive = row[Columns.isActive]
        priority = row[Columns.priority]
    }

    init(id: String, service: DebridServiceType, apiToken: String, isActive: Bool = true, priority: Int = 0) {
        self.id = id
        self.service = service
        self.apiToken = apiToken
        self.isActive = isActive
        self.priority = priority
    }
}

/// Indexer configuration.
struct IndexerConfig: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "indexer_configs"

    var id: String
    var type: IndexerType
    var baseURL: String
    var apiKey: String?
    var isActive: Bool
    var displayName: String?
    var providerSubtype: ProviderSubtype
    var endpointPath: String
    var categoryFilter: String?
    var priority: Int

    enum IndexerType: String, Codable, Sendable, CaseIterable {
        case jackett
        case prowlarr
        case torznab
        case zilean
        case stremioAddon = "stremio_addon"
        case builtIn = "built_in"

        var displayName: String {
            switch self {
            case .jackett: return "Jackett"
            case .prowlarr: return "Prowlarr"
            case .torznab: return "Torznab"
            case .zilean: return "Zilean"
            case .stremioAddon: return "Stremio Addon"
            case .builtIn: return "Built-in Scrapers"
            }
        }
    }

    enum ProviderSubtype: String, Codable, Sendable, CaseIterable {
        case jackett
        case prowlarr
        case customTorznab = "custom_torznab"
        case stremioAddon = "stremio_addon"
        case builtIn = "built_in"

        var displayName: String {
            switch self {
            case .jackett: return "Jackett"
            case .prowlarr: return "Prowlarr"
            case .customTorznab: return "Custom Torznab"
            case .stremioAddon: return "Stremio Addon"
            case .builtIn: return "Built-in"
            }
        }
    }

    enum Columns: String, ColumnExpression {
        case id, type, baseURL, apiKey, isActive
        case displayName, providerSubtype, endpointPath, categoryFilter, priority
    }

    func encode(to container: inout PersistenceContainer) {
        container[Columns.id] = id
        container[Columns.type] = type.rawValue
        container[Columns.baseURL] = baseURL
        container[Columns.apiKey] = apiKey
        container[Columns.isActive] = isActive
        container[Columns.displayName] = displayName
        container[Columns.providerSubtype] = providerSubtype.rawValue
        container[Columns.endpointPath] = endpointPath
        container[Columns.categoryFilter] = categoryFilter
        container[Columns.priority] = priority
    }

    init(row: Row) throws {
        id = row[Columns.id]
        type = IndexerConfig.IndexerType(rawValue: row[Columns.type] as String) ?? .builtIn
        baseURL = row[Columns.baseURL]
        apiKey = row[Columns.apiKey]
        isActive = row[Columns.isActive]
        displayName = row[Columns.displayName]
        providerSubtype = IndexerConfig.ProviderSubtype(rawValue: row[Columns.providerSubtype] as String? ?? "") ?? type.defaultProviderSubtype
        endpointPath = row[Columns.endpointPath] ?? type.defaultEndpointPath
        categoryFilter = row[Columns.categoryFilter]
        priority = row[Columns.priority] ?? 0
    }

    init(
        id: String,
        type: IndexerType,
        baseURL: String,
        apiKey: String? = nil,
        isActive: Bool = true,
        displayName: String? = nil,
        providerSubtype: ProviderSubtype? = nil,
        endpointPath: String? = nil,
        categoryFilter: String? = nil,
        priority: Int = 0
    ) {
        self.id = id
        self.type = type
        self.baseURL = baseURL
        self.apiKey = apiKey
        self.isActive = isActive
        self.displayName = displayName
        self.providerSubtype = providerSubtype ?? type.defaultProviderSubtype
        self.endpointPath = endpointPath ?? type.defaultEndpointPath
        self.categoryFilter = categoryFilter
        self.priority = priority
    }
}

private extension IndexerConfig.IndexerType {
    var defaultProviderSubtype: IndexerConfig.ProviderSubtype {
        switch self {
        case .jackett:
            return .jackett
        case .prowlarr:
            return .prowlarr
        case .torznab, .zilean:
            return .customTorznab
        case .stremioAddon:
            return .stremioAddon
        case .builtIn:
            return .builtIn
        }
    }

    var defaultEndpointPath: String {
        switch self {
        case .jackett:
            return "/api/v2.0/indexers/all/results/torznab/api"
        case .prowlarr:
            return "/api/v1/search"
        case .torznab, .zilean:
            return "/api"
        case .stremioAddon:
            // Stremio addons are configured by their base manifest URL; the
            // stream sub-path (/stream/{type}/{id}.json) is appended per-request.
            return ""
        case .builtIn:
            return ""
        }
    }
}
