import CoreGraphics

/// Pure sizing math for aligning the player controls overlay with the rendered
/// video frame.
///
/// `VLCVideoView` aspect-fits the decoded picture inside its bounds and paints black
/// bars over the remainder, so a controls overlay anchored to the window bounds ends
/// up floating on the letterbox/pillarbox bars. Constraining a shared container to
/// the video's aspect ratio lets the controls hug the picture edges instead.
enum PlayerVideoFrameLayout {
    /// The picture aspect ratio (width / height) for a known video size, or `nil`
    /// when the size is unknown (before the first decoded frame, or for audio-only
    /// media). A `nil` result tells the caller to fill the whole window as before.
    static func aspectRatio(for videoSize: CGSize) -> CGFloat? {
        guard videoSize.width > 0, videoSize.height > 0 else { return nil }
        return videoSize.width / videoSize.height
    }

    /// Aspect-fits `videoSize` inside `containerSize`, returning the size of the
    /// rendered picture (the region the controls should hug).
    ///
    /// Returns `nil` when either size is degenerate or the video size is unknown,
    /// signalling the caller to fill the container exactly as before so nothing
    /// regresses for audio-only or pre-first-frame playback.
    static func fittedSize(containerSize: CGSize, videoSize: CGSize) -> CGSize? {
        guard containerSize.width > 0, containerSize.height > 0,
              let ratio = aspectRatio(for: videoSize) else {
            return nil
        }

        let containerAspect = containerSize.width / containerSize.height
        if containerAspect > ratio {
            // Container is wider than the picture: full height, pillarbox on the sides.
            let height = containerSize.height
            return CGSize(width: height * ratio, height: height)
        } else {
            // Container is taller than the picture: full width, letterbox top/bottom.
            let width = containerSize.width
            return CGSize(width: width, height: width / ratio)
        }
    }
}
