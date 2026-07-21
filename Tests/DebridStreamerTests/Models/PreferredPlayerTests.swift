import Testing
@testable import DebridStreamer

@Suite("PreferredPlayer Tests")
struct PreferredPlayerTests {
    @Test("Display names map every case")
    func displayNames() {
        let names = Dictionary(uniqueKeysWithValues: PreferredPlayer.allCases.map { ($0, $0.displayName) })
        #expect(names[.auto] == "Auto (IINA/VLC/mpv)")
        #expect(names[.builtIn] == "Built-in Player")
        #expect(names[.iina] == "IINA")
        #expect(names[.vlc] == "VLC")
        #expect(names[.mpv] == "mpv")
        #expect(names[.quickTime] == "QuickTime Player")
        #expect(names[.systemDefault] == "System Default App")
    }

    @Test("Bundle identifiers are present for external players")
    func bundleIdentifiers() {
        #expect(PreferredPlayer.iina.bundleIdentifier == "com.colliderli.iina")
        #expect(PreferredPlayer.vlc.bundleIdentifier == "org.videolan.vlc")
        #expect(PreferredPlayer.mpv.bundleIdentifier == "io.mpv")
        #expect(PreferredPlayer.quickTime.bundleIdentifier == "com.apple.QuickTimePlayerX")
        #expect(PreferredPlayer.auto.bundleIdentifier == nil)
        #expect(PreferredPlayer.builtIn.bundleIdentifier == nil)
        #expect(PreferredPlayer.systemDefault.bundleIdentifier == nil)
    }

    @Test("Auto priority includes expected application order")
    func autoPriorityOrder() {
        #expect(PreferredPlayer.autoBundlePriority.first == "com.colliderli.iina")
        #expect(PreferredPlayer.autoBundlePriority == [
            "com.colliderli.iina",
            "org.videolan.vlc",
            "io.mpv",
            "com.apple.QuickTimePlayerX"
        ])
    }
}
