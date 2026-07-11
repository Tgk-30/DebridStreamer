import Testing
import CoreGraphics
@testable import DebridStreamer

@Suite("PlayerVideoFrameLayout Tests")
struct PlayerVideoFrameLayoutTests {
    private let tolerance: CGFloat = 0.01

    @Test("Aspect ratio is width over height for a valid video size")
    func aspectRatioForValidSize() throws {
        let ratio = try #require(
            PlayerVideoFrameLayout.aspectRatio(for: CGSize(width: 1920, height: 1080))
        )
        #expect(abs(ratio - (16.0 / 9.0)) < tolerance)
    }

    @Test("Aspect ratio is nil when the video size is unknown or degenerate")
    func aspectRatioUnknownIsNil() {
        #expect(PlayerVideoFrameLayout.aspectRatio(for: .zero) == nil)
        #expect(PlayerVideoFrameLayout.aspectRatio(for: CGSize(width: 1920, height: 0)) == nil)
        #expect(PlayerVideoFrameLayout.aspectRatio(for: CGSize(width: 0, height: 1080)) == nil)
    }

    @Test("A 2.39:1 video letterboxes inside a 16:10 window (controls move inward vertically)")
    func letterboxWideVideo() throws {
        let fitted = try #require(
            PlayerVideoFrameLayout.fittedSize(
                containerSize: CGSize(width: 1600, height: 1000),
                videoSize: CGSize(width: 2390, height: 1000)
            )
        )
        // The picture spans the full window width; its height shrinks, leaving equal
        // black bars at the top and bottom that the controls now sit inside of.
        #expect(abs(fitted.width - 1600) < tolerance)
        #expect(abs(fitted.height - (1600 / 2.39)) < 0.5)
        #expect(fitted.height < 1000)
    }

    @Test("A 4:3 video pillarboxes inside a 16:9 window (controls move inward horizontally)")
    func pillarboxTallVideo() throws {
        let fitted = try #require(
            PlayerVideoFrameLayout.fittedSize(
                containerSize: CGSize(width: 1920, height: 1080),
                videoSize: CGSize(width: 4, height: 3)
            )
        )
        // The picture spans the full window height; its width shrinks, leaving equal
        // black bars on the left and right that the controls now sit inside of.
        #expect(abs(fitted.height - 1080) < tolerance)
        #expect(abs(fitted.width - 1440) < tolerance)
        #expect(fitted.width < 1920)
    }

    @Test("A video that matches the window aspect fills it completely")
    func exactFitFillsContainer() throws {
        let fitted = try #require(
            PlayerVideoFrameLayout.fittedSize(
                containerSize: CGSize(width: 1280, height: 720),
                videoSize: CGSize(width: 1920, height: 1080)
            )
        )
        #expect(abs(fitted.width - 1280) < tolerance)
        #expect(abs(fitted.height - 720) < tolerance)
    }

    @Test("Fitted size is nil when the video size is unknown (fall back to full window)")
    func fittedSizeZeroVideoIsNil() {
        #expect(
            PlayerVideoFrameLayout.fittedSize(
                containerSize: CGSize(width: 1600, height: 1000),
                videoSize: .zero
            ) == nil
        )
    }

    @Test("Fitted size is nil when the container is degenerate")
    func fittedSizeZeroContainerIsNil() {
        #expect(
            PlayerVideoFrameLayout.fittedSize(
                containerSize: .zero,
                videoSize: CGSize(width: 1920, height: 1080)
            ) == nil
        )
    }

    @Test("The fitted picture never exceeds the container bounds")
    func fittedSizeStaysWithinContainer() throws {
        let container = CGSize(width: 800, height: 600)
        let fitted = try #require(
            PlayerVideoFrameLayout.fittedSize(
                containerSize: container,
                videoSize: CGSize(width: 2560, height: 1080)
            )
        )
        #expect(fitted.width <= container.width + tolerance)
        #expect(fitted.height <= container.height + tolerance)
    }
}
