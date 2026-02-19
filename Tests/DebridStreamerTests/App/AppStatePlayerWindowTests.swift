import Testing
import Foundation
@testable import DebridStreamer

@Suite("AppState Player Window Tests")
@MainActor
struct AppStatePlayerWindowTests {
    @Test("Opening player sets active session and newer open replaces older session")
    func openReplacesExistingSession() {
        let appState = AppState(secretStore: InMemorySecretStore())
        let first = PlayerSessionRequest(
            stream: makeStream("https://cdn.example.com/a.mkv"),
            mediaTitle: "A",
            mediaId: "tt-a",
            episodeId: nil
        )
        let second = PlayerSessionRequest(
            stream: makeStream("https://cdn.example.com/b.mkv"),
            mediaTitle: "B",
            mediaId: "tt-b",
            episodeId: nil
        )

        appState.openPlayer(first)
        #expect(appState.activePlayerSession?.id == first.id)

        appState.openPlayer(second)
        #expect(appState.activePlayerSession?.id == second.id)

        appState.closePlayer()
        #expect(appState.activePlayerSession == nil)
    }

    @Test("Window close callback only clears matching request")
    func windowCloseUsesMatchingRequestID() {
        let appState = AppState(secretStore: InMemorySecretStore())
        let request = PlayerSessionRequest(
            stream: makeStream("https://cdn.example.com/a.mkv"),
            mediaTitle: "A",
            mediaId: "tt-a",
            episodeId: nil
        )
        appState.openPlayer(request)

        appState.playerWindowDidClose(requestID: UUID())
        #expect(appState.activePlayerSession?.id == request.id)

        appState.playerWindowDidClose(requestID: request.id)
        #expect(appState.activePlayerSession == nil)
    }

    @Test("Fullscreen callbacks are scoped to active request")
    func fullscreenCallbacksMatchActiveRequest() {
        let appState = AppState(secretStore: InMemorySecretStore())
        let request = PlayerSessionRequest(
            stream: makeStream("https://cdn.example.com/a.mkv"),
            mediaTitle: "A",
            mediaId: "tt-a",
            episodeId: nil
        )
        appState.openPlayer(request)
        #expect(appState.activePlayerIsFullscreen == false)

        appState.playerWindowDidChangeFullscreen(requestID: UUID(), isFullscreen: true)
        #expect(appState.activePlayerIsFullscreen == false)

        appState.playerWindowDidChangeFullscreen(requestID: request.id, isFullscreen: true)
        #expect(appState.activePlayerIsFullscreen == true)

        appState.playerWindowDidClose(requestID: request.id)
        #expect(appState.activePlayerIsFullscreen == false)
    }

    private func makeStream(_ url: String) -> StreamInfo {
        StreamInfo(
            streamURL: url,
            quality: .hd1080p,
            codec: .h264,
            audio: .aac,
            source: .webDL,
            sizeBytes: 1_000_000_000,
            fileName: "Movie.1080p",
            debridService: "Real-Debrid"
        )
    }
}
