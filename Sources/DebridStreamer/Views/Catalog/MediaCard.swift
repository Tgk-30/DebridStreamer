import SwiftUI

struct MediaCard: View {
    let item: MediaPreview

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
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
                        .overlay { ProgressView() }
                @unknown default:
                    posterPlaceholder
                }
            }
            .frame(width: 150, height: 225)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .shadow(radius: 4)

            // Title
            Text(item.title)
                .font(.caption)
                .fontWeight(.medium)
                .lineLimit(2)
                .frame(width: 150, alignment: .leading)

            // Year + Rating
            HStack(spacing: 4) {
                if let year = item.year {
                    Text(String(year))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if !item.ratingString.isEmpty {
                    HStack(spacing: 2) {
                        Image(systemName: "star.fill")
                            .font(.caption2)
                            .foregroundStyle(.yellow)
                        Text(item.ratingString)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: 150)
        }
        .padding(8)
        .glassSurface()
        .contentShape(Rectangle())
    }

    private var posterPlaceholder: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [Color.accentColor.opacity(0.24), Color.indigo.opacity(0.18), Color.black.opacity(0.45)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(width: 150, height: 225)
            .overlay(alignment: .center) {
                Image(systemName: "film")
                    .font(.title2)
                    .foregroundStyle(.white.opacity(0.8))
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
                .padding(8)
                .foregroundStyle(.white)
                .background(Color.black.opacity(0.3))
            }
    }
}
