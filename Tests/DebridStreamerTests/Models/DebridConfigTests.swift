import Testing
import Foundation
@testable import DebridStreamer

@Suite("DebridServiceType Tests")
struct DebridServiceTypeTests {
    @Test("Display names")
    func displayNames() {
        #expect(DebridServiceType.realDebrid.displayName == "Real-Debrid")
        #expect(DebridServiceType.allDebrid.displayName == "AllDebrid")
        #expect(DebridServiceType.premiumize.displayName == "Premiumize")
        #expect(DebridServiceType.torBox.displayName == "TorBox")
    }

    @Test("Base URLs")
    func baseURLs() {
        #expect(DebridServiceType.realDebrid.baseURL.contains("real-debrid.com"))
        #expect(DebridServiceType.allDebrid.baseURL.contains("alldebrid.com"))
        #expect(DebridServiceType.premiumize.baseURL.contains("premiumize.me"))
        #expect(DebridServiceType.torBox.baseURL.contains("torbox.app"))
    }

    @Test("All cases")
    func allCases() {
        #expect(DebridServiceType.allCases.count == 4)
    }

    @Test("Raw values")
    func rawValues() {
        #expect(DebridServiceType.realDebrid.rawValue == "real_debrid")
        #expect(DebridServiceType.allDebrid.rawValue == "all_debrid")
        #expect(DebridServiceType.premiumize.rawValue == "premiumize")
        #expect(DebridServiceType.torBox.rawValue == "torbox")
    }
}

@Suite("DebridConfig Tests")
struct DebridConfigTests {
    @Test("DebridConfig creation")
    func creation() {
        let config = DebridConfig(
            id: "rd-1",
            service: .realDebrid,
            apiToken: "test-token",
            isActive: true,
            priority: 0
        )
        #expect(config.id == "rd-1")
        #expect(config.service == .realDebrid)
        #expect(config.apiToken == "test-token")
        #expect(config.isActive == true)
        #expect(config.priority == 0)
    }

    @Test("DebridConfig defaults")
    func defaults() {
        let config = DebridConfig(
            id: "ad-1",
            service: .allDebrid,
            apiToken: "token"
        )
        #expect(config.isActive == true)
        #expect(config.priority == 0)
    }
}

@Suite("IndexerConfig Tests")
struct IndexerConfigTests {
    @Test("IndexerType display names")
    func indexerTypeDisplayNames() {
        #expect(IndexerConfig.IndexerType.jackett.displayName == "Jackett")
        #expect(IndexerConfig.IndexerType.prowlarr.displayName == "Prowlarr")
        #expect(IndexerConfig.IndexerType.torznab.displayName == "Torznab")
        #expect(IndexerConfig.IndexerType.zilean.displayName == "Zilean")
        #expect(IndexerConfig.IndexerType.builtIn.displayName == "Built-in Scrapers")
    }

    @Test("IndexerConfig creation")
    func creation() {
        let config = IndexerConfig(
            id: "jackett-1",
            type: .jackett,
            baseURL: "http://localhost:9117",
            apiKey: "abc123"
        )
        #expect(config.id == "jackett-1")
        #expect(config.type == .jackett)
        #expect(config.baseURL == "http://localhost:9117")
        #expect(config.apiKey == "abc123")
        #expect(config.isActive == true)
        #expect(config.priority == 0)
        #expect(config.endpointPath.contains("torznab"))
    }
}

@Suite("DebridError Tests")
struct DebridErrorTests {
    @Test("Error descriptions")
    func errorDescriptions() {
        #expect(DebridError.invalidToken.errorDescription?.contains("Invalid") == true)
        #expect(DebridError.expired.errorDescription?.contains("expired") == true)
        #expect(DebridError.rateLimited.errorDescription?.contains("Rate limit") == true)
        #expect(DebridError.torrentNotFound("abc").errorDescription?.contains("abc") == true)
        #expect(DebridError.noFilesAvailable.errorDescription?.contains("No downloadable") == true)
        #expect(DebridError.downloadFailed("reason").errorDescription?.contains("reason") == true)
        #expect(DebridError.httpError(500, "server error").errorDescription?.contains("500") == true)
        #expect(DebridError.networkError("timeout").errorDescription?.contains("timeout") == true)
    }

    @Test("Error equality")
    func errorEquality() {
        #expect(DebridError.invalidToken == DebridError.invalidToken)
        #expect(DebridError.httpError(404, "not found") == DebridError.httpError(404, "not found"))
        #expect(DebridError.httpError(404, "not found") != DebridError.httpError(500, "server error"))
    }
}
