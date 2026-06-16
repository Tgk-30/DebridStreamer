import SwiftUI

/// Full-bleed 16:9 cinematic spotlight at the top of Discover. Renders a featured
/// item's backdrop with a bottom-to-top scrim, title, overview, and Play/Details
/// actions. Callers are responsible for only constructing this when a backdrop
/// exists (see `DiscoverView.heroItem`).
struct HeroSpotlight: View {
    let item: MediaPreview
    /// `MediaPreview` carries no overview, so the page supplies one when it can
    /// resolve richer metadata (e.g. from the cache); otherwise the line is hidden.
    var overview: String? = nil
    var onPlay: () -> Void
    var onDetails: () -> Void

    private let heroHeight: CGFloat = 380

    var body: some View {
        // Anchor every layer to a fixed-size box via overlays. A fill-mode image
        // placed directly in a ZStack drives the stack taller than the frame, which
        // then center-clips the bottom content (title/buttons). Overlays on a
        // Color.clear box guarantee backdrop, scrim, and content share one frame.
        Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: heroHeight)
            .overlay { backdrop }
            .overlay { scrim }
            .overlay(alignment: .bottomLeading) { content }
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.lg, style: .continuous))
            .glassElevation(.hero, radius: AppTheme.Radius.lg, tint: AppTheme.accent)
            .accessibilityElement(children: .contain)
    }

    private var backdrop: some View {
        CachedAsyncImage(url: item.backdropURL) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            case .empty:
                ZStack {
                    AppTheme.heroGradient
                    ProgressView()
                }
            default:
                AppTheme.heroGradient
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    /// Bottom-to-top dark scrim so the title/overview stay legible over any image.
    private var scrim: some View {
        LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: .black.opacity(0.25), location: 0.4),
                .init(color: .black.opacity(0.72), location: 0.78),
                .init(color: .black.opacity(0.92), location: 1)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            HStack(spacing: AppTheme.Spacing.sm) {
                Label("Featured", systemImage: "sparkles")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, AppTheme.Spacing.sm)
                    .padding(.vertical, AppTheme.Spacing.xxs)
                    .glassChip()
                if let year = item.year {
                    Text(String(year))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white.opacity(0.85))
                }
                if !item.ratingString.isEmpty {
                    HStack(spacing: 2) {
                        Image(systemName: "star.fill")
                            .font(.caption2)
                            .foregroundStyle(AppTheme.warning)
                        Text(item.ratingString)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.9))
                    }
                }
            }

            Text(item.title)
                .font(.system(.largeTitle, design: .rounded).weight(.bold))
                .foregroundStyle(.white)
                .lineLimit(2)
                .shadow(color: .black.opacity(0.4), radius: 8, y: 2)

            if let overview, !overview.isEmpty {
                Text(overview)
                    .font(.callout)
                    .foregroundStyle(.white.opacity(0.85))
                    .lineLimit(2)
                    .frame(maxWidth: 560, alignment: .leading)
            }

            HStack(spacing: AppTheme.Spacing.md) {
                Button(action: onPlay) {
                    Label("Play", systemImage: "play.fill")
                }
                .buttonStyle(.glassProminent)

                Button(action: onDetails) {
                    Label("Details", systemImage: "info.circle")
                }
                .buttonStyle(.glass)
            }
            .padding(.top, AppTheme.Spacing.xs)
        }
        .padding(AppTheme.Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
