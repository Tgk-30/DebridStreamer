import SwiftUI
import AppKit

struct PlayerSessionRequest: Identifiable, Sendable {
    let id: UUID
    let stream: StreamInfo
    let availableStreams: [StreamInfo]
    let mediaTitle: String
    let mediaId: String
    let episodeId: String?

    init(
        id: UUID = UUID(),
        stream: StreamInfo,
        availableStreams: [StreamInfo] = [],
        mediaTitle: String,
        mediaId: String,
        episodeId: String?
    ) {
        self.id = id
        self.stream = stream
        self.availableStreams = availableStreams
        self.mediaTitle = mediaTitle
        self.mediaId = mediaId
        self.episodeId = episodeId
    }
}

@MainActor
final class PlayerWindowController: NSObject, NSWindowDelegate {
    private weak var appState: AppState?
    private let request: PlayerSessionRequest
    private var window: NSWindow?
    private var hostingController: NSHostingController<AnyView>?
    private var isClosing = false
    private var didNotifyClose = false
    private var terminationObserver: NSObjectProtocol?

    init(appState: AppState, request: PlayerSessionRequest) {
        self.appState = appState
        self.request = request
        super.init()
        terminationObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.close()
            }
        }
    }

    deinit {
        if let terminationObserver {
            NotificationCenter.default.removeObserver(terminationObserver)
        }
    }

    func show() {
        guard let appState else { return }

        let playerView = PlayerView(
            stream: request.stream,
            availableStreams: request.availableStreams,
            mediaTitle: request.mediaTitle,
            mediaId: request.mediaId,
            episodeId: request.episodeId,
            onClose: { [weak self] in
                self?.close()
            }
        )
        .environment(appState)

        let hostingController = NSHostingController(rootView: AnyView(playerView))
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = request.mediaTitle
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.backgroundColor = .black
        window.minSize = NSSize(width: 860, height: 520)
        window.contentViewController = hostingController
        window.delegate = self
        window.center()
        window.makeKeyAndOrderFront(nil)

        self.hostingController = hostingController
        self.window = window
    }

    func close() {
        guard !isClosing else { return }
        isClosing = true
        guard let window else {
            finishCloseLifecycle()
            return
        }
        if window.isVisible {
            window.performClose(nil)
        } else {
            finishCloseLifecycle()
        }
    }

    func windowWillClose(_ notification: Notification) {
        finishCloseLifecycle()
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        appState?.playerWindowDidChangeFullscreen(requestID: request.id, isFullscreen: true)
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        appState?.playerWindowDidChangeFullscreen(requestID: request.id, isFullscreen: false)
    }

    private func finishCloseLifecycle() {
        let closingWindow = window
        closingWindow?.delegate = nil
        window = nil
        hostingController = nil
        appState?.playerWindowDidChangeFullscreen(requestID: request.id, isFullscreen: false)
        notifyCloseIfNeeded()
        isClosing = false
    }

    private func notifyCloseIfNeeded() {
        guard !didNotifyClose else { return }
        didNotifyClose = true
        appState?.playerWindowDidClose(requestID: request.id)
    }
}
