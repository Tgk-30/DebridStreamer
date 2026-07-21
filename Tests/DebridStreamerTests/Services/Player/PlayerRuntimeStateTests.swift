import Testing
@testable import DebridStreamer

@Suite("PlayerRuntimeState Tests")
struct PlayerRuntimeStateTests {
    @Test("display names map to readable runtime labels")
    func runtimeStateDisplayNames() {
        #expect(PlayerRuntimeState.preparing.displayName == "Preparing")
        #expect(PlayerRuntimeState.buffering.displayName == "Buffering")
        #expect(PlayerRuntimeState.playing.displayName == "Playing")
        #expect(PlayerRuntimeState.stalled.displayName == "Stalled")
        #expect(PlayerRuntimeState.failed.displayName == "Failed")
        #expect(PlayerRuntimeState.fallbackLaunched.displayName == "Fallback Launched")
    }
}
