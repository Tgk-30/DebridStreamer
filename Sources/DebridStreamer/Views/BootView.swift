import SwiftUI
import AVFoundation
import AppKit

/// Full-bleed AVPlayer surface with no transport controls - used for the launch animation.
private final class BootPlayerNSView: NSView {
    let playerLayer = AVPlayerLayer()

    init(player: AVPlayer) {
        super.init(frame: .zero)
        wantsLayer = true
        layer = CALayer()
        layer?.backgroundColor = NSColor.black.cgColor
        playerLayer.player = player
        playerLayer.videoGravity = .resizeAspectFill
        layer?.addSublayer(playerLayer)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layout() {
        super.layout()
        playerLayer.frame = bounds
    }
}

private struct BootVideoSurface: NSViewRepresentable {
    let player: AVPlayer
    func makeNSView(context: Context) -> NSView { BootPlayerNSView(player: player) }
    func updateNSView(_ nsView: NSView, context: Context) {}
}

/// Launch / boot animation. Plays the bundled intro video once, fades in the
/// wordmark, then calls `onFinish` when the video ends (or after a safety timeout).
struct BootView: View {
    let onFinish: () -> Void

    @State private var player = AVPlayer()
    @State private var wordmarkVisible = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            BootVideoSurface(player: player)
                .ignoresSafeArea()

            // Soft vignette so the wordmark stays legible over any frame.
            RadialGradient(
                colors: [.clear, Color.black.opacity(0.55)],
                center: .center, startRadius: 120, endRadius: 620
            )
            .ignoresSafeArea()

            VStack(spacing: AppTheme.Spacing.md) {
                Image(systemName: "play.tv.fill")
                    .font(.system(size: 54))
                    .foregroundStyle(AppTheme.heroGradient)
                    .shadow(color: AppTheme.accent.opacity(0.6), radius: 18)
                Text("DebridStreamer")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.5), radius: 12, y: 4)
            }
            .opacity(wordmarkVisible ? 1 : 0)
            .scaleEffect(wordmarkVisible ? 1 : 0.94)
            .animation(.easeOut(duration: 0.9), value: wordmarkVisible)
        }
        .task {
            await runBootSequence()
        }
    }

    private func runBootSequence() async {
        guard let url = Bundle.module.url(forResource: "BootVideo", withExtension: "mp4") else {
            onFinish()
            return
        }
        let item = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: item)
        player.isMuted = true
        player.actionAtItemEnd = .pause
        player.play()
        wordmarkVisible = true

        // Finish when the clip ends, or after a safety timeout (clip is ~6s).
        let ended = NotificationCenter.default.notifications(named: .AVPlayerItemDidPlayToEndTime, object: item)
        await withTaskGroup(of: Void.self) { group in
            group.addTask { for await _ in ended { break } }
            group.addTask { try? await Task.sleep(nanoseconds: 8_500_000_000) }
            _ = await group.next()
            group.cancelAll()
        }
        onFinish()
    }
}
