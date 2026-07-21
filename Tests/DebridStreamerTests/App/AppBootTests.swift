import Testing
import Foundation
import AppKit
import SwiftUI
@testable import DebridStreamer

@Suite("DebridStreamer app bootstrap tests")
@MainActor
struct DebridStreamerAppTests {
    @Test("DebridStreamerApp body can be evaluated")
    func appBodyCanBeConstructed() {
        let app = DebridStreamerApp()
        _ = app.body
    }

    @Test("AppDelegate installs standard edit menu if missing")
    func appDelegateInstallsEditMenu() {
        NSApplication.shared.mainMenu = nil
        let delegate = AppDelegate()
        let notification = Notification(name: NSApplication.didFinishLaunchingNotification)
        delegate.applicationDidFinishLaunching(notification)

        let initialEditCount = NSApplication.shared.mainMenu?.items.filter { $0.title == "Edit" }.count ?? 0
        #expect(initialEditCount == 1)

        // Re-running launch should preserve single Edit menu.
        delegate.applicationDidFinishLaunching(notification)
        let secondEditCount = NSApplication.shared.mainMenu?.items.filter { $0.title == "Edit" }.count ?? 0
        #expect(secondEditCount == 1)
    }

    @Test("AppDelegate reactivation requests app activation")
    func appDelegateReactivation() {
        let delegate = AppDelegate()
        delegate.applicationDidBecomeActive(Notification(name: NSApplication.didBecomeActiveNotification))
    }
}
