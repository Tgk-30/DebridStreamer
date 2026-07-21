import Testing
@testable import DebridStreamer

@Suite("InternalPlayerBackend Tests")
struct InternalPlayerBackendTests {
    @Test("display names cover automatic and vlc")
    func displayNames() {
        #expect(InternalPlayerBackend.automatic.displayName == "Automatic (VLC)")
        #expect(InternalPlayerBackend.vlc.displayName == "VLC")
    }

    @Test("caseIterable includes both backends")
    func allCases() {
        #expect(InternalPlayerBackend.allCases == [.automatic, .vlc])
    }

    @Test("raw values stay stable")
    func rawValues() {
        #expect(InternalPlayerBackend.automatic.rawValue == "automatic")
        #expect(InternalPlayerBackend.vlc.rawValue == "vlc")
    }
}
