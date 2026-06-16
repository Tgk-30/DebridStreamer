import SwiftUI
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Force app activation so text inputs work immediately.
        // Without this, SwiftUI text fields in SPM executables don't accept keyboard input.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        // Ensure the standard Edit menu exists with Cut/Copy/Paste/Select All.
        // SPM executables don't get this automatically unlike Xcode app bundles.
        setupEditMenu()
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        // Re-activate on focus to ensure text fields remain responsive
        NSApp.activate(ignoringOtherApps: false)
    }

    private func setupEditMenu() {
        let mainMenu = NSApp.mainMenu ?? NSMenu()
        NSApp.mainMenu = mainMenu

        // Check if Edit menu already exists
        if mainMenu.item(withTitle: "Edit") == nil {
            let editMenu = NSMenu(title: "Edit")

            let undoItem = NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
            let redoItem = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
            let cutItem = NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
            let copyItem = NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
            let pasteItem = NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
            let selectAllItem = NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
            let deleteItem = NSMenuItem(title: "Delete", action: #selector(NSText.delete(_:)), keyEquivalent: "\u{8}")
            deleteItem.keyEquivalentModifierMask = []

            editMenu.addItem(undoItem)
            editMenu.addItem(redoItem)
            editMenu.addItem(NSMenuItem.separator())
            editMenu.addItem(cutItem)
            editMenu.addItem(copyItem)
            editMenu.addItem(pasteItem)
            editMenu.addItem(deleteItem)
            editMenu.addItem(NSMenuItem.separator())
            editMenu.addItem(selectAllItem)

            let editMenuItem = NSMenuItem()
            editMenuItem.title = "Edit"
            editMenuItem.submenu = editMenu

            // Insert Edit menu after the app menu (index 1)
            let insertIndex = min(1, mainMenu.items.count)
            mainMenu.insertItem(editMenuItem, at: insertIndex)
        }
    }
}

@main
struct DebridStreamerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1280, height: 860)

        Settings {
            SettingsView()
                .environment(appState)
        }
    }
}
