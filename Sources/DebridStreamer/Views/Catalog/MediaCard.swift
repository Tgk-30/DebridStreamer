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
            .fill(.quaternary)
            .frame(width: 150, height: 225)
            .overlay {
                VStack(spacing: 4) {
                    Image(systemName: "film")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text(item.title)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)
                }
            }
    }
}
