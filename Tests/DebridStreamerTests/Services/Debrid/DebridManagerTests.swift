import Testing
import Foundation
@testable import DebridStreamer

@Suite("DebridManager Tests")
struct DebridManagerTests {
    @Test("Has no services initially")
    func initialEmpty() async {
        let manager = DebridManager()
        let has = await manager.hasServices
        #expect(has == false)
    }

    @Test("Configure from debrid configs")
    func configureFromConfigs() async {
        let manager = DebridManager()
        let configs = [
            DebridConfig(id: "rd", service: .realDebrid, apiToken: "token1", isActive: true, priority: 0),
            DebridConfig(id: "ad", service: .allDebrid, apiToken: "token2", isActive: true, priority: 1),
        ]
        await manager.configure(configs: configs)
        let has = await manager.hasServices
        #expect(has == true)

        let types = await manager.activeServiceTypes
        #expect(types.count == 2)
        #expect(types.contains(.realDebrid))
        #expect(types.contains(.allDebrid))
    }

    @Test("Configure sorts by priority and keeps only active configs")
    func configureOrdersByPriority() async {
        let manager = DebridManager()
        let configs = [
            DebridConfig(id: "low", service: .allDebrid, apiToken: "token2", isActive: true, priority: 10),
            DebridConfig(id: "high", service: .realDebrid, apiToken: "token1", isActive: true, priority: 1),
            DebridConfig(id: "mid", service: .torBox, apiToken: "token3", isActive: false, priority: 5),
        ]

        await manager.configure(configs: configs)

        let types = await manager.activeServiceTypes
        #expect(types == [.realDebrid, .allDebrid])
    }

    @Test("Inactive configs are filtered out")
    func inactiveFiltered() async {
        let manager = DebridManager()
        let configs = [
            DebridConfig(id: "rd", service: .realDebrid, apiToken: "token1", isActive: true),
            DebridConfig(id: "pm", service: .premiumize, apiToken: "token2", isActive: false),
        ]
        await manager.configure(configs: configs)
        let types = await manager.activeServiceTypes
        #expect(types.count == 1)
        #expect(types[0] == .realDebrid)
    }

    @Test("Reconfigure clears old services")
    func reconfigure() async {
        let manager = DebridManager()
        let configs1 = [
            DebridConfig(id: "rd", service: .realDebrid, apiToken: "token1", isActive: true),
        ]
        await manager.configure(configs: configs1)
        #expect(await manager.activeServiceTypes.count == 1)

        let configs2 = [
            DebridConfig(id: "ad", service: .allDebrid, apiToken: "token2", isActive: true),
            DebridConfig(id: "tb", service: .torBox, apiToken: "token3", isActive: true),
        ]
        await manager.configure(configs: configs2)
        let types = await manager.activeServiceTypes
        #expect(types.count == 2)
        #expect(!types.contains(.realDebrid))
        #expect(types.contains(.allDebrid))
        #expect(types.contains(.torBox))
    }

    @Test("Resolve stream with no services throws")
    func resolveNoServices() async {
        let manager = DebridManager()
        do {
            _ = try await manager.resolveStream(hash: "abc123")
            #expect(Bool(false), "Should have thrown")
        } catch {
            #expect(error is DebridError)
        }
    }

    @Test("Resolve with preferred service not found throws")
    func resolvePreferredNotFound() async {
        let manager = DebridManager()
        let configs = [
            DebridConfig(id: "rd", service: .realDebrid, apiToken: "token1", isActive: true),
        ]
        await manager.configure(configs: configs)

        do {
            _ = try await manager.resolveStream(hash: "abc", preferredService: .torBox)
            #expect(Bool(false), "Should have thrown")
        } catch {
            #expect(error is DebridError)
        }
    }

    @Test("CheckCacheAll with empty hashes returns empty")
    func checkCacheEmpty() async throws {
        let manager = DebridManager()
        let result = try await manager.checkCacheAll(hashes: [])
        #expect(result.isEmpty)
    }

    @Test("Configure resolves keychain token references")
    func configureWithSecretReference() async throws {
        let secretStore = InMemorySecretStore()
        try await secretStore.setSecret("rd-token", for: SecretKey.debridToken(service: .realDebrid))

        let manager = DebridManager(secretStore: secretStore)
        let configs = [
            DebridConfig(
                id: "rd",
                service: .realDebrid,
                apiToken: SecretReference.encode(key: SecretKey.debridToken(service: .realDebrid)),
                isActive: true
            )
        ]
        await manager.configure(configs: configs)

        let types = await manager.activeServiceTypes
        #expect(types == [.realDebrid])
    }

    @Test("Configure accepts non-secret token strings without secret lookup")
    func configureAcceptsRawTokenWithoutDecoding() async {
        let manager = DebridManager(secretStore: InMemorySecretStore())
        let configs = [
            DebridConfig(
                id: "rd",
                service: .realDebrid,
                apiToken: "not-a-secret-reference",
                isActive: true
            )
        ]

        await manager.configure(configs: configs)
        let types = await manager.activeServiceTypes
        #expect(types == [.realDebrid])
    }

    @Test("Configure skips keychain references with missing secret")
    func configureSkipsMissingSecretReference() async {
        let manager = DebridManager(secretStore: InMemorySecretStore())
        let configs = [
            DebridConfig(
                id: "rd",
                service: .realDebrid,
                apiToken: SecretReference.encode(key: SecretKey.debridToken(service: .realDebrid)),
                isActive: true
            )
        ]
        await manager.configure(configs: configs)

        let has = await manager.hasServices
        #expect(has == false)
    }
}

@Suite("IndexerManager Tests")
struct IndexerManagerTests {
    @Test("Built-in indexers present by default")
    func defaultIndexers() async {
        let manager = IndexerManager()
        let names = await manager.activeIndexers
        #expect(names.contains("YTS"))
        #expect(names.contains("EZTV"))
        #expect(names.contains("APIBay"))
        #expect(names.count == 3)
    }

    @Test("Add custom indexer")
    func addIndexer() async {
        let manager = IndexerManager()
        await manager.addIndexer(MockIndexer(name: "Custom"))
        let names = await manager.activeIndexers
        #expect(names.count == 4)
        #expect(names.contains("Custom"))
    }

    @Test("Set indexers replaces all")
    func setIndexers() async {
        let manager = IndexerManager()
        await manager.setIndexers([MockIndexer(name: "Only")])
        let names = await manager.activeIndexers
        #expect(names.count == 1)
        #expect(names[0] == "Only")
    }

    @Test("Search errors are tracked")
    func searchErrorsTracked() async {
        let manager = IndexerManager()
        await manager.setIndexers([FailingIndexer()])
        _ = await manager.searchAll(imdbId: "tt1234567", type: .movie)
        let errors = await manager.lastSearchErrors
        #expect(!errors.isEmpty)
        #expect(errors[0].indexer == "Failing")
    }

    @Test("Search deduplicates by hash keeping higher seeders")
    func searchDeduplication() async {
        let indexer1 = MockResultIndexer(name: "A", results: [
            TorrentResult.fromSearch(infoHash: "abc", title: "Test", sizeBytes: 100, seeders: 10, leechers: 1, indexerName: "A")
        ])
        let indexer2 = MockResultIndexer(name: "B", results: [
            TorrentResult.fromSearch(infoHash: "abc", title: "Test Better", sizeBytes: 200, seeders: 50, leechers: 2, indexerName: "B")
        ])

        let manager = IndexerManager()
        await manager.setIndexers([indexer1, indexer2])
        let results = await manager.searchAll(imdbId: "tt123", type: .movie)

        #expect(results.count == 1)
        #expect(results[0].seeders == 50) // Higher seeders version kept
    }

    @Test("Text search fallback works")
    func textSearchFallback() async {
        let indexer = MockResultIndexer(name: "Test", queryResults: [
            TorrentResult.fromSearch(infoHash: "xyz", title: "Jujutsu Kaisen S03E01", sizeBytes: 1000, seeders: 100, leechers: 5, indexerName: "Test")
        ])

        let manager = IndexerManager()
        await manager.setIndexers([indexer])
        let results = await manager.searchByQuery("Jujutsu Kaisen S03E01", type: .series)

        #expect(results.count == 1)
        #expect(results[0].infoHash == "xyz")
    }
}

// MARK: - APIBay Indexer Tests

@Suite("APIBayIndexer Tests")
struct APIBayIndexerTests {
    @Test("APIBay parses valid JSON response")
    func parseResponse() throws {
        let json = """
        [
            {
                "id": "12345",
                "name": "Test Movie 2024 1080p BluRay",
                "info_hash": "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
                "leechers": "10",
                "seeders": "50",
                "size": "1500000000",
                "num_files": "3",
                "username": "uploader",
                "added": "1700000000",
                "status": "vip",
                "category": "207",
                "imdb": "tt1234567"
            }
        ]
        """
        let data = json.data(using: .utf8)!
        let items = try JSONDecoder().decode([APIBayItem].self, from: data)

        #expect(items.count == 1)
        #expect(items[0].name == "Test Movie 2024 1080p BluRay")
        #expect(items[0].infoHash == "ABCDEF1234567890ABCDEF1234567890ABCDEF12")
        #expect(items[0].seeders == "50")
        #expect(items[0].size == "1500000000")
        #expect(items[0].imdb == "tt1234567")
    }

    @Test("APIBay filters no results placeholder")
    func noResultsPlaceholder() throws {
        let json = """
        [
            {
                "id": "0",
                "name": "No results returned",
                "info_hash": "0000000000000000000000000000000000000000",
                "leechers": "0",
                "seeders": "0",
                "size": "0",
                "num_files": "0",
                "username": "",
                "added": "0",
                "status": "",
                "category": "",
                "imdb": ""
            }
        ]
        """
        let data = json.data(using: .utf8)!
        let items = try JSONDecoder().decode([APIBayItem].self, from: data)

        #expect(items.count == 1)
        #expect(items[0].name == "No results returned")
    }

    @Test("Season episode formatting")
    func seasonEpisodeFormatting() {
        // Test the format helper indirectly through TorrentResult title parsing
        let result = TorrentResult.fromSearch(
            infoHash: "abc123",
            title: "Show S03E01 1080p WEB-DL",
            sizeBytes: 1_000_000,
            seeders: 50,
            leechers: 5,
            indexerName: "APIBay"
        )

        #expect(result.quality == .hd1080p)
        #expect(result.source == .webDL)
        #expect(result.indexerName == "APIBay")
    }
}

// MARK: - YTS Response Parsing Tests

@Suite("YTS Response Parsing Tests")
struct YTSResponseParsingTests {
    @Test("YTS parses movie with torrents")
    func parseMovieTorrents() throws {
        let json = """
        {
            "status": "ok",
            "data": {
                "movie_count": 1,
                "movies": [
                    {
                        "id": 1,
                        "title": "Inception",
                        "title_long": "Inception (2010)",
                        "year": 2010,
                        "imdb_code": "tt1375666",
                        "torrents": [
                            {
                                "hash": "AABBCCDD11223344",
                                "quality": "1080p",
                                "type": "bluray",
                                "seeds": 150,
                                "peers": 20,
                                "size": "2.0 GB",
                                "size_bytes": 2000000000
                            }
                        ]
                    }
                ]
            }
        }
        """

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let response = try decoder.decode(YTSResponse.self, from: json.data(using: .utf8)!)

        #expect(response.status == "ok")
        #expect(response.data.movies?.count == 1)
        let movie = response.data.movies![0]
        #expect(movie.title == "Inception")
        #expect(movie.torrents?.count == 1)
        let torrent = movie.torrents![0]
        #expect(torrent.hash == "AABBCCDD11223344")
        #expect(torrent.quality == "1080p")
        #expect(torrent.seeds == 150)
        #expect(torrent.sizeBytes == 2000000000)
    }

    @Test("YTS handles empty movies array")
    func emptyMovies() throws {
        let json = """
        {"status": "ok", "data": {"movie_count": 0, "movies": null}}
        """
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let response = try decoder.decode(YTSResponse.self, from: json.data(using: .utf8)!)
        #expect(response.data.movies == nil)
    }
}

// MARK: - EZTV Response Parsing Tests

@Suite("EZTV Response Parsing Tests")
struct EZTVResponseParsingTests {
    @Test("EZTV parses TV show torrents")
    func parseTVTorrents() throws {
        let json = """
        {
            "torrents_count": 1,
            "page": 1,
            "torrents": [
                {
                    "id": 100,
                    "hash": "1234abcd5678ef90",
                    "filename": "Show.S01E01.720p.mkv",
                    "title": "Show S01E01 720p WEB-DL",
                    "season": "1",
                    "episode": "1",
                    "seeds": 75,
                    "peers": 12,
                    "size_bytes": "800000000",
                    "magnet_url": "magnet:?xt=urn:btih:1234abcd5678ef90"
                }
            ]
        }
        """

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let response = try decoder.decode(EZTVResponse.self, from: json.data(using: .utf8)!)

        #expect(response.torrentsCount == 1)
        #expect(response.torrents?.count == 1)
        let torrent = response.torrents![0]
        #expect(torrent.hash == "1234abcd5678ef90")
        #expect(torrent.season == "1")
        #expect(torrent.episode == "1")
        #expect(torrent.seeds == 75)
        #expect(torrent.sizeBytes == "800000000")
    }

    @Test("EZTV handles empty torrents")
    func emptyTorrents() throws {
        let json = """
        {"torrents_count": 0, "page": 1, "torrents": []}
        """
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let response = try decoder.decode(EZTVResponse.self, from: json.data(using: .utf8)!)
        #expect(response.torrents?.isEmpty == true)
    }
}

// MARK: - Test Helpers

/// A mock indexer for testing.
struct MockIndexer: TorrentIndexer {
    let name: String
    func search(imdbId: String, type: MediaType, season: Int?, episode: Int?) async throws -> [TorrentResult] {
        return []
    }
}

/// A mock indexer that returns preset results.
struct MockResultIndexer: TorrentIndexer {
    let name: String
    var results: [TorrentResult] = []
    var queryResults: [TorrentResult] = []

    func search(imdbId: String, type: MediaType, season: Int?, episode: Int?) async throws -> [TorrentResult] {
        return results
    }

    func searchByQuery(query: String, type: MediaType) async throws -> [TorrentResult] {
        return queryResults
    }
}

/// A mock indexer that always fails.
struct FailingIndexer: TorrentIndexer {
    let name = "Failing"

    func search(imdbId: String, type: MediaType, season: Int?, episode: Int?) async throws -> [TorrentResult] {
        throw NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "Test error"])
    }

    func searchByQuery(query: String, type: MediaType) async throws -> [TorrentResult] {
        throw NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "Test error"])
    }
}
