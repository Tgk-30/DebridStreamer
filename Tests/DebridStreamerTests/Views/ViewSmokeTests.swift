import Testing
import SwiftUI
import AppKit
@testable import DebridStreamer

@Suite("SwiftUI View Smoke Coverage")
@MainActor
struct ViewSmokeCoverageTests {
    private let samplePreview = MediaPreview(
        id: "test-media-1",
        type: .movie,
        title: "Example Film",
        year: 2024,
        posterPath: "/poster.jpg",
        imdbRating: 8.2,
        tmdbId: 123,
        backdropPath: "/backdrop.jpg"
    )

    private var sampleMediaItem: MediaItem {
        MediaItem(
            id: "tt1234567",
            type: .movie,
            title: "Example Film",
            year: 2024,
            overview: "A compact coverage fixture.",
            genres: ["Drama", "Action"],
            imdbRating: 8.2,
            rtRating: 93,
            runtime: 116,
            status: "Released",
            tmdbId: 123
        )
    }

    private var sampleStream: StreamInfo {
        StreamInfo(
            streamURL: "https://example.com/example.mp4",
            quality: .hd1080p,
            codec: .h264,
            audio: .aac,
            source: .webDL,
            sizeBytes: 900_000_000,
            fileName: "example.mp4",
            debridService: "RD"
        )
    }

    private var sampleTorrent: TorrentResult {
        TorrentResult(
            infoHash: "hash-12345",
            title: "Sample Torrent",
            sizeBytes: 2_000_000,
            quality: .hd720p,
            codec: .h264,
            audio: .ac3,
            source: .webDL,
            seeders: 15,
            leechers: 4,
            indexerName: "test-indexer"
        )
    }

    private func mountView<V: View>(_ view: V) {
        let hosting = NSHostingController(rootView: view)
        _ = hosting.view
        hosting.view.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.001))
    }

    @Test("Primary screen views are body-evaluable")
    func primaryScreenViews() {
        let appState = AppState(secretStore: InMemorySecretStore())

        mountView(BootView {})
        mountView(DiscoverView().environment(appState))
        mountView(SearchView().environment(appState))
        mountView(LibraryView().environment(appState))
        mountView(HistoryView().environment(appState))
        mountView(AIAssistantView().environment(appState))
        mountView(SettingsView().environment(appState))
        mountView(SetupView().environment(appState))
        mountView(ContentView().environment(appState))
    }

    @Test("Catalog and component views are body-evaluable")
    func catalogAndComponentViews() {
        let appState = AppState(secretStore: InMemorySecretStore())

        mountView(
            ContinueWatchingCard(
                item: ContinueWatchingItem(
                    preview: samplePreview,
                    progress: 0.32,
                    progressString: "00:15 / 00:45",
                    isInProgress: true
                ),
                onResume: {}
            )
        )

        mountView(
            HeroSpotlight(
                item: samplePreview,
                overview: "Example spotlight overview.",
                onPlay: {},
                onDetails: {}
            )
        )

        mountView(MediaCard(item: samplePreview))
        mountView(MoodDiscoveryView().environment(appState))
        mountView(RatingFeedbackSheet(
            title: "Rate this title",
            mode: .likeDislike,
            value: Binding(get: { 1.0 }, set: { _ in }),
            onCancel: {},
            onSave: {}
        ))
        mountView(RatingFeedbackSheet(
            title: "Rate this title",
            mode: .scale1to10,
            value: Binding(get: { 9.0 }, set: { _ in }),
            onCancel: {},
            onSave: {}
        ))
        mountView(RatingFeedbackSheet(
            title: "Rate this title",
            mode: .scale1to100,
            value: Binding(get: { 80.0 }, set: { _ in }),
            onCancel: {},
            onSave: {}
        ))
        mountView(RatingFeedbackSheet(
            title: "Rate this title",
            mode: .none,
            value: Binding(get: { nil }, set: { _ in }),
            onCancel: {},
            onSave: {}
        ))

        mountView(
            NativeTextField(
                placeholder: "API key",
                text: Binding(get: { "" }, set: { _ in }),
                isSecure: false,
                font: .systemFont(ofSize: 12),
                onSubmit: nil
            )
        )
        mountView(
            NativeInputField(
                placeholder: "Input",
                text: Binding(get: { "" }, set: { _ in }),
                onSubmit: nil
            )
        )
        mountView(
            NativeSecureField(
                placeholder: "Secret",
                text: Binding(get: { "" }, set: { _ in }),
                onSubmit: nil
            )
        )
    }

    @Test("Detail, person, search, and stream views are body-evaluable")
    func detailAndStreamViews() {
        let appState = AppState(secretStore: InMemorySecretStore())

        mountView(DetailView(mediaPreview: samplePreview).environment(appState))
        mountView(PersonView(personId: 42, initialName: "Sample Cast").environment(appState))
        mountView(
            StreamListView(
                mediaItem: sampleMediaItem,
                torrents: [sampleTorrent],
                cacheResults: [sampleTorrent.infoHash: (.realDebrid, .cached(fileId: nil, fileName: nil, fileSize: nil))],
                onPlay: { _ in }
            ).environment(appState)
        )

        mountView(NavRail().environment(appState))
        mountView(GlobalSearchField().environment(appState))
    }

    @Test("Player view and layout wrappers are body-evaluable")
    func playerViews() {
        let appState = AppState(secretStore: InMemorySecretStore())

        mountView(
            PlayerView(
                stream: sampleStream,
                availableStreams: [sampleStream],
                mediaTitle: "Example Film",
                mediaId: "tt1234567",
                episodeId: nil,
                sessionRequestID: UUID(),
                onClose: {}
            ).environment(appState)
        )
    }
}
