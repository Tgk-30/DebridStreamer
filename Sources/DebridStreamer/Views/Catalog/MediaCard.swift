import SwiftUI

struct MediaCard: View {
    let item: MediaPreview
    @State private var hovering = false

    private let posterWidth: CGFloat = 158
    private let posterHeight: CGFloat = 237

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            // Poster
            AsyncImage(url: item.posterURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(2/3, contentMode: .fill)
                case .failure:
                    posterPlaceholder
                case .empty:
                    posterPlaceholder
                        .overlay { ProgressView().controlSize(.small) }
                @unknown default:
                    posterPlaceholder
                }
            }
            .frame(width: posterWidth, height: posterHeight)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AppTheme.Radius.sm, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
            )

            // Title
            Text(item.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
                .frame(width: posterWidth, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)

            // Year + Rating
            HStack(spacing: AppTheme.Spacing.xs) {
                if let year = item.year {
                    Text(String(year))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if !item.ratingString.isEmpty {
                    HStack(spacing: 2) {
                        Image(systemName: "star.fill")
                            .font(.caption2)
                            .foregroundStyle(AppTheme.warning)
                        Text(item.ratingString)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: posterWidth)
        }
        .padding(AppTheme.Spacing.sm)
        .glassCard(elevated: hovering)
        .contentShape(Rectangle())
        .scaleEffect(hovering ? 1.03 : 1)
        .shadow(color: AppTheme.accent.opacity(hovering ? 0.28 : 0), radius: 18, y: 10)
        .animation(.spring(response: 0.32, dampingFraction: 0.72), value: hovering)
        .onHover { hovering = $0 }
    }

    private var posterPlaceholder: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [AppTheme.accent.opacity(0.45), AppTheme.accentSecondary.opacity(0.3), Color.black.opacity(0.5)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(width: posterWidth, height: posterHeight)
            .overlay(alignment: .center) {
                Image(systemName: "film.stack")
                    .font(.title)
                    .foregroundStyle(.white.opacity(0.85))
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.caption2.weight(.semibold))
                        .lineLimit(2)
                    Text("Artwork unavailable")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.7))
                }
                .padding(AppTheme.Spacing.sm)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.ultraThinMaterial)
            }
    }
}
