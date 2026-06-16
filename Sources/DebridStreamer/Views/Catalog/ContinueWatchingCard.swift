import SwiftUI

/// A distinct landscape (16:9) Continue-Watching card: backdrop (falling back to
/// poster), a bottom scrim with title + remaining-time label, a Resume affordance,
/// and a thin inset progress bar tinted with the accent to read as "active".
struct ContinueWatchingCard: View {
    let item: ContinueWatchingItem
    var onResume: () -> Void

    @State private var hovering = false

    private let cardWidth: CGFloat = 300
    private var cardHeight: CGFloat { cardWidth * 9 / 16 }

    private var preview: MediaPreview { item.preview }
    private var artworkURL: URL? { preview.backdropURL ?? preview.posterURL }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            artwork
                .frame(width: cardWidth, height: cardHeight)
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.md, style: .continuous))
                .overlay(alignment: .bottom) { progressBar }
                .overlay {
                    RoundedRectangle(cornerRadius: AppTheme.Radius.md, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
                }
        }
        .frame(width: cardWidth)
        .glassElevation(hovering ? .hero : .raised, radius: AppTheme.Radius.md)
        .contentShape(Rectangle())
        .scaleEffect(hovering ? 1.02 : 1)
        .animation(.spring(response: 0.32, dampingFraction: 0.74), value: hovering)
        .onHover { hovering = $0 }
        .onTapGesture(perform: onResume)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Resume \(preview.title), \(item.progressString)")
    }

    private var artwork: some View {
        CachedAsyncImage(url: artworkURL) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(16 / 9, contentMode: .fill)
            case .empty:
                ZStack {
                    Rectangle().fill(.quaternary)
                    ProgressView().controlSize(.small)
                }
            default:
                placeholder
            }
        }
        .overlay { scrim }
        .overlay(alignment: .bottomLeading) { caption }
        .overlay(alignment: .topTrailing) { resumeBadge }
    }

    private var scrim: some View {
        LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: .black.opacity(0.35), location: 0.55),
                .init(color: .black.opacity(0.85), location: 1)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var caption: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(preview.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Text(item.progressString)
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.8))
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, AppTheme.Spacing.md)
        .padding(.bottom, AppTheme.Spacing.md)
        .padding(.trailing, AppTheme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var resumeBadge: some View {
        Image(systemName: "play.fill")
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .padding(AppTheme.Spacing.sm)
            .background(.ultraThinMaterial, in: Circle())
            .overlay(Circle().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.75))
            .padding(AppTheme.Spacing.sm)
            .opacity(hovering ? 1 : 0.85)
            .scaleEffect(hovering ? 1.06 : 1)
    }

    /// Thin inset progress bar — accent fill signals "active" resume position.
    private var progressBar: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.22))
                Capsule()
                    .fill(AppTheme.accent)
                    .frame(width: max(4, proxy.size.width * item.progress))
                    .shadow(color: AppTheme.accent.opacity(0.5), radius: 4, y: 0)
            }
        }
        .frame(height: 3)
        .padding(.horizontal, AppTheme.Spacing.sm)
        .padding(.bottom, AppTheme.Spacing.sm)
    }

    private var placeholder: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [AppTheme.accent.opacity(0.45), AppTheme.accentSecondary.opacity(0.3), Color.black.opacity(0.5)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay {
                Image(systemName: "film.stack")
                    .font(.title)
                    .foregroundStyle(.white.opacity(0.85))
            }
    }
}
