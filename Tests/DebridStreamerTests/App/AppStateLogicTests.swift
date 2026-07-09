import Testing
import Foundation
@testable import DebridStreamer

/// Deterministic, pure-logic coverage for `AppState`'s player-session lifecycle.
///
/// `resolveModelID(preset:custom:defaultModel:)` is `private` on `AppState` and is
/// only reachable through `reloadAIAssistantManager()`, which in turn requires a
/// fully-bootstrapped `settingsManager` (i.e. `initialize()` and its DB/network
/// side effects). That is not a "smallest reachable path", so per the area brief
/// this suite instead exhaustively exercises the request-ID matching in
/// `openPlayer` / `closePlayer` / `playerWindowDidClose(requestID:)`, focusing on
/// scenarios distinct from `AppStatePlayerWindowTests`.
@Suite("AppState Logic Tests")
@MainActor
struct AppStateLogicTests {

    @Test("Fresh AppState has no active player session or fullscreen state")
    func initialPlayerStateIsEmpty() {
        let appState = AppState(secretStore: InMemorySecretStore())
        #expect(appState.activePlayerSession == nil)
        #expect(appState.activePlayerIsFullscreen == false)
    }

    @Test("closePlayer is idempotent and clears state even when nothing is open")
    func closePlayerWithoutOpenIsSafe() {
        let appState = AppState(secretStore: InMemorySecretStore())

        // Closing with no active session must not crash and must leave state clear.
        appState.closePlayer()
        #expect(appState.activePlayerSession == nil)
        #expect(appState.activePlayerIsFullscreen == false)

        // Open then close, then close again - second close is a no-op.
        let request = Self.makeRequest()
        appState.openPlayer(request)
        #expect(appState.activePlayerSession?.id == request.id)

        appState.closePlayer()
        #expect(appState.activePlayerSession == nil)
        appState.closePlayer()
        #expect(appState.activePlayerSession == nil)
    }

    @Test("openPlayer resets fullscreen state inherited from a prior session")
    func openPlayerResetsFullscreen() {
        let appState = AppState(secretStore: InMemorySecretStore())
        let first = Self.makeRequest(title: "First")
        appState.openPlayer(first)

        // Drive the first session into fullscreen.
        appState.playerWindowDidChangeFullscreen(requestID: first.id, isFullscreen: true)
        #expect(appState.activePlayerIsFullscreen == true)

        // Opening a new session must start non-fullscreen and adopt the new request.
        let second = Self.makeRequest(title: "Second")
        appState.openPlayer(second)
        #expect(appState.activePlayerSession?.id == second.id)
        #expect(appState.activePlayerIsFullscreen == false)
    }

    @Test("playerWindowDidClose for a superseded request does not clear the new session")
    func staleCloseAfterReplaceIsIgnored() {
        let appState = AppState(secretStore: InMemorySecretStore())
        let old = Self.makeRequest(title: "Old")
        let new = Self.makeRequest(title: "New")

        appState.openPlayer(old)
        appState.openPlayer(new) // replaces `old`; `new` is now active
        #expect(appState.activePlayerSession?.id == new.id)

        // A late close callback from the OLD window must not tear down the NEW session.
        appState.playerWindowDidClose(requestID: old.id)
        #expect(appState.activePlayerSession?.id == new.id)

        // The matching close for the active session does clear it.
        appState.playerWindowDidClose(requestID: new.id)
        #expect(appState.activePlayerSession == nil)
    }

    @Test("Fullscreen change for a non-active request is ignored")
    func fullscreenChangeForStaleRequestIsIgnored() {
        let appState = AppState(secretStore: InMemorySecretStore())
        let active = Self.makeRequest(title: "Active")
        let stale = Self.makeRequest(title: "Stale")

        appState.openPlayer(active)
        #expect(appState.activePlayerIsFullscreen == false)

        // A fullscreen toggle keyed to a different (stale) request must be dropped.
        appState.playerWindowDidChangeFullscreen(requestID: stale.id, isFullscreen: true)
        #expect(appState.activePlayerIsFullscreen == false)

        // The matching request can toggle fullscreen on and back off.
        appState.playerWindowDidChangeFullscreen(requestID: active.id, isFullscreen: true)
        #expect(appState.activePlayerIsFullscreen == true)
        appState.playerWindowDidChangeFullscreen(requestID: active.id, isFullscreen: false)
        #expect(appState.activePlayerIsFullscreen == false)
    }

    @Test("playerWindowDidClose with a random request ID never clears an active session")
    func randomCloseIDLeavesSessionIntact() {
        let appState = AppState(secretStore: InMemorySecretStore())
        let request = Self.makeRequest()
        appState.openPlayer(request)

        for _ in 0..<5 {
            appState.playerWindowDidClose(requestID: UUID())
            #expect(appState.activePlayerSession?.id == request.id)
        }
    }

    // MARK: - Helpers

    private static func makeRequest(title: String = "Movie") -> PlayerSessionRequest {
        PlayerSessionRequest(
            stream: makeStream("https://cdn.example.com/\(title).mkv"),
            mediaTitle: title,
            mediaId: "tt-\(title)",
            episodeId: nil
        )
    }

    private static func makeStream(_ url: String) -> StreamInfo {
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
