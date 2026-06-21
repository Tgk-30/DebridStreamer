import Testing
import Foundation
@testable import DebridStreamer

@Suite("ExternalPlayerLauncher Tests")
struct ExternalPlayerLauncherTests {
    @Test("Auto mode prefers IINA before other apps")
    func autoPrefersIINA() async {
        var openedBundles: [String] = []

        let launcher = ExternalPlayerLauncher(
            resolveApplicationInstalled: { bundleID in
                bundleID == "com.colliderli.iina" || bundleID == "org.videolan.vlc"
            },
            openWithBundle: { _, bundleID in
                openedBundles.append(bundleID)
                return true
            },
            openWithDefaultApplication: { _ in
                false
            }
        )

        let url = URL(string: "https://stream.example/movie.mp4")!
        let launched = await launcher.launch(url: url, preference: .auto)

        #expect(launched == true)
        #expect(openedBundles == ["com.colliderli.iina"])
    }

    @Test("Specific player fails when app is not installed")
    func specificPlayerMissing() async {
        var defaultOpenCalls = 0

        let launcher = ExternalPlayerLauncher(
            resolveApplicationInstalled: { _ in false },
            openWithBundle: { _, _ in
                false
            },
            openWithDefaultApplication: { _ in
                defaultOpenCalls += 1
                return true
            }
        )

        let url = URL(string: "https://stream.example/movie.mp4")!
        let launched = await launcher.launch(url: url, preference: .vlc)

        #expect(launched == false)
        #expect(defaultOpenCalls == 0)
    }

    @Test("Auto mode falls back to system default when no preferred apps exist")
    func autoFallsBackToDefault() async {
        var defaultOpenCalls = 0

        let launcher = ExternalPlayerLauncher(
            resolveApplicationInstalled: { _ in false },
            openWithBundle: { _, _ in
                false
            },
            openWithDefaultApplication: { _ in
                defaultOpenCalls += 1
                return true
            }
        )

        let url = URL(string: "https://stream.example/movie.mp4")!
        let launched = await launcher.launch(url: url, preference: .auto)

        #expect(launched == true)
        #expect(defaultOpenCalls == 1)
    }

    @Test("Built-in mode never launches external apps")
    func builtInDoesNotLaunchExternal() async {
        var bundleOpenCalls = 0
        var defaultOpenCalls = 0

        let launcher = ExternalPlayerLauncher(
            resolveApplicationInstalled: { _ in true },
            openWithBundle: { _, _ in
                bundleOpenCalls += 1
                return true
            },
            openWithDefaultApplication: { _ in
                defaultOpenCalls += 1
                return true
            }
        )

        let url = URL(string: "https://stream.example/movie.mp4")!
        let launched = await launcher.launch(url: url, preference: .builtIn)

        #expect(launched == false)
        #expect(bundleOpenCalls == 0)
        #expect(defaultOpenCalls == 0)
    }
}
