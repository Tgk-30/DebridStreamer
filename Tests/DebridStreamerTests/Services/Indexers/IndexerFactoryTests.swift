import Testing
import Foundation
@testable import DebridStreamer

@Suite("IndexerFactory Tests")
struct IndexerFactoryTests {
    @Test("buildIndexers adds built-in indexers by default and external configs")
    func buildIndexersAddsBuiltInsAndExternal() async {
        let configs = [
            IndexerConfig(
                id: "jack",
                type: .jackett,
                baseURL: "https://jack.example.com",
                apiKey: "key",
                displayName: "  Jackett External  ",
                endpointPath: "/api/v2.0/indexers/all/results/torznab/api",
                priority: 10
            )
        ]

        let indexers = IndexerFactory.buildIndexers(from: configs)

        #expect(indexers.count == 4)
        #expect(indexers[0].name == "APIBay")
        #expect(indexers[1].name == "YTS")
        #expect(indexers[2].name == "EZTV")
        #expect(indexers[3].name == "Jackett External")
        #expect(indexers[3] is TorznabIndexer)
    }

    @Test("buildIndexers respects built-in toggle and sorts external indexers by priority")
    func buildIndexersRespectsPriorityAndBuiltInToggle() async {
        let configs = [
            IndexerConfig(
                id: "builtin",
                type: .builtIn,
                baseURL: "",
                isActive: false
            ),
            IndexerConfig(
                id: "jack",
                type: .jackett,
                baseURL: "https://jack.example.com",
                apiKey: "jkey",
                displayName: "Jackett Fast",
                endpointPath: "/api/v2.0/indexers/all/results/torznab/api",
                priority: 9
            ),
            IndexerConfig(
                id: "pro",
                type: .prowlarr,
                baseURL: "https://prowlarr.example.com",
                apiKey: "pkey",
                displayName: "    Prowlarr Core   ",
                endpointPath: "/api/v1/search",
                priority: 2
            ),
            IndexerConfig(
                id: "bad",
                type: .zilean,
                baseURL: "  ",
                apiKey: "bad",
                displayName: "Bad Zilean"
            )
        ]

        let indexers = IndexerFactory.buildIndexers(from: configs)
        #expect(indexers.count == 2)
        #expect(indexers[0].name == "Prowlarr Core")
        #expect(indexers[1].name == "Jackett Fast")
    }

    @Test("testConnection validates prowlarr API-key header and query parameters")
    func testConnectionBuildsProwlarrProbe() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        var sawHeader: String?
        var seenApiParam = false
        var seenCategory = false

        MockURLProtocol.setHandler({ request in
            sawHeader = request.value(forHTTPHeaderField: "X-Api-Key")

            let queryItems = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            for item in queryItems {
                if item.name == "apikey" {
                    seenApiParam = true
                }
                if item.name == "cat", item.value == "4,7" {
                    seenCategory = true
                }
            }

            let body = """
            <?xml version="1.0"?><rss version="2.0"><channel></channel></rss>
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let config = IndexerConfig(
            id: "pro",
            type: .prowlarr,
            baseURL: "http://localhost:9696",
            apiKey: "prowlarr-secret",
            displayName: "Prowlarr Probe",
            endpointPath: "/api/v1/search",
            categoryFilter: "4,7",
            priority: 1
        )

        let ok = await IndexerFactory.testConnection(config: config, session: session)
        #expect(ok == true)
        #expect(sawHeader == "prowlarr-secret")
        #expect(seenApiParam == false)
        #expect(seenCategory == true)
    }

    @Test("testConnection fails for empty/tommy external base URL")
    func testConnectionFailsOnEmptyExternalBase() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ _ in
            return try makeResponse(for:
                URLRequest(url: URL(string: "https://example.invalid")!),
                statusCode: 500,
                body: ""
            )
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let config = IndexerConfig(
            id: "bad",
            type: .jackett,
            baseURL: "  "
        )

        let ok = await IndexerFactory.testConnection(config: config, session: session)
        #expect(ok == false)
    }

    @Test("buildIndexers ignores baseURL that only contains whitespace")
    func buildIndexersSkipsWhitespaceOnlyBaseURLs() async {
        let configs = [
            IndexerConfig(
                id: "bad",
                type: .zilean,
                baseURL: "   ",
                displayName: "No URL"
            ),
            IndexerConfig(
                id: "good",
                type: .stremioAddon,
                baseURL: "https://addon.example.com",
                displayName: "My Addon"
            )
        ]

        let indexers = IndexerFactory.buildIndexers(from: configs)
        #expect(indexers.count == 4)
        #expect(indexers.contains { $0.name == "My Addon" })
        #expect(indexers.allSatisfy { $0.name != "No URL" })
    }

    private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url else {
            throw NSError(domain: "IndexerFactoryTests", code: 1)
        }
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        ) else {
            throw NSError(domain: "IndexerFactoryTests", code: 2)
        }
        return (response, Data(body.utf8))
    }
}
