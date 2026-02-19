import Foundation
import AppKit

/// Launches stream URLs in external playback apps.
struct ExternalPlayerLauncher {
    typealias ApplicationResolver = (String) -> Bool
    typealias BundleOpener = (URL, String) async -> Bool
    typealias DefaultOpener = (URL) async -> Bool

    private let resolveApplicationInstalled: ApplicationResolver
    private let openWithBundle: BundleOpener
    private let openWithDefaultApplication: DefaultOpener

    init(
        resolveApplicationInstalled: @escaping ApplicationResolver,
        openWithBundle: @escaping BundleOpener,
        openWithDefaultApplication: @escaping DefaultOpener
    ) {
        self.resolveApplicationInstalled = resolveApplicationInstalled
        self.openWithBundle = openWithBundle
        self.openWithDefaultApplication = openWithDefaultApplication
    }

    static let live = ExternalPlayerLauncher(
        resolveApplicationInstalled: { bundleID in
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) != nil
        },
        openWithBundle: { url, bundleID in
            guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else {
                return false
            }

            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true

            return await withCheckedContinuation { continuation in
                NSWorkspace.shared.open([url], withApplicationAt: appURL, configuration: configuration) { app, error in
                    continuation.resume(returning: app != nil && error == nil)
                }
            }
        },
        openWithDefaultApplication: { url in
            NSWorkspace.shared.open(url)
        }
    )

    /// Returns true when an external app accepted the URL.
    func launch(url: URL, preference: PreferredPlayer) async -> Bool {
        switch preference {
        case .builtIn:
            return false

        case .systemDefault:
            return await openWithDefaultApplication(url)

        case .auto:
            for bundleID in PreferredPlayer.autoBundlePriority where resolveApplicationInstalled(bundleID) {
                if await openWithBundle(url, bundleID) {
                    return true
                }
            }
            return await openWithDefaultApplication(url)

        case .iina, .vlc, .mpv, .quickTime:
            guard let bundleID = preference.bundleIdentifier,
                  resolveApplicationInstalled(bundleID) else {
                return false
            }
            return await openWithBundle(url, bundleID)
        }
    }
}
