import SwiftUI

/// Person / Cast page (Overseerr/Jellyseerr pattern). Presented as a sheet from a
/// tapped cast headshot. Shows the person's profile (headshot + name + dept +
/// truncated bio) and their filmography as a poster grid. Tapping a title opens
/// that title's DetailView in a nested sheet, mirroring "More like this".
struct PersonView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let personId: Int
    /// Name shown instantly in the header before the profile fetch resolves
    /// (TMDB cast credits already carry the name).
    let initialName: String

    @State private var person: Person?
    @State private var credits: [MediaPreview] = []
    @State private var isLoading = true
    @State private var bioExpanded = false
    /// Tapping a filmography poster opens that title in a nested detail sheet.
    @State private var selectedTitle: MediaPreview?

    private let columns = [
        GridItem(.adaptive(minimum: 158, maximum: 180), spacing: AppTheme.Spacing.lg, alignment: .top)
    ]

    var body: some View {
        ZStack(alignment: .topTrailing) {
            AppTheme.background.ignoresSafeArea()
            AppTheme.auroraGlow

            ScrollView {
                VStack(alignment: .leading, spacing: AppTheme.Spacing.xl) {
                    profileHeader

                    if let bio = person?.biography, !bio.isEmpty {
                        biographySection(bio)
                    }

                    filmographySection
                }
                .padding(AppTheme.Spacing.xl)
            }

            closeButton
        }
        .task { await load() }
        .sheet(item: $selectedTitle) { item in
            DetailView(mediaPreview: item)
                .frame(minWidth: 880, idealWidth: 900, minHeight: 580)
        }
    }

    // MARK: - Header

    private var profileHeader: some View {
        HStack(alignment: .top, spacing: AppTheme.Spacing.xl) {
            CachedAsyncImage(url: person?.profileLargeURL ?? person?.profileURL) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                default:
                    ZStack {
                        Rectangle().fill(.quaternary)
                        Image(systemName: "person.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: 140, height: 200)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AppTheme.Radius.md, style: .continuous)
                    .strokeBorder(AppTheme.glassBorder, lineWidth: 1)
            )

            VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                Text(person?.name ?? initialName)
                    .font(.system(.largeTitle, design: .rounded).weight(.bold))
                    .lineLimit(2)

                if let dept = person?.knownForDepartment, !dept.isEmpty {
                    Text(dept)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(AppTheme.accent)
                }

                HStack(spacing: AppTheme.Spacing.md) {
                    if let birthday = person?.birthday, !birthday.isEmpty {
                        metaItem(icon: "calendar", text: birthday)
                    }
                    if let place = person?.placeOfBirth, !place.isEmpty {
                        metaItem(icon: "mappin.and.ellipse", text: place)
                    }
                }

                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .padding(.top, AppTheme.Spacing.xs)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func metaItem(icon: String, text: String) -> some View {
        HStack(spacing: AppTheme.Spacing.xs) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    // MARK: - Biography (truncated, tap to expand)

    private func biographySection(_ bio: String) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            Text("Biography")
                .font(.title3)
                .fontWeight(.semibold)
            Text(bio)
                .font(.body)
                .foregroundStyle(.secondary)
                .lineSpacing(2)
                .lineLimit(bioExpanded ? nil : 5)
                .frame(maxWidth: 640, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            if bio.count > 280 {
                Button(bioExpanded ? "Show less" : "Show more") {
                    withAnimation(.easeInOut(duration: 0.2)) { bioExpanded.toggle() }
                }
                .buttonStyle(.glass)
                .controlSize(.small)
            }
        }
        .padding(AppTheme.Spacing.lg)
        .glassElevation(.rest, radius: AppTheme.Radius.md)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Filmography grid

    @ViewBuilder
    private var filmographySection: some View {
        if !credits.isEmpty {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                Text("Known for")
                    .font(.title2)
                    .fontWeight(.bold)

                LazyVGrid(columns: columns, alignment: .leading, spacing: AppTheme.Spacing.lg) {
                    ForEach(credits) { item in
                        Button {
                            selectedTitle = item
                        } label: {
                            MediaCard(item: item)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        } else if !isLoading {
            VStack(spacing: AppTheme.Spacing.sm) {
                Image(systemName: "film.stack")
                    .font(.system(size: 32))
                    .foregroundStyle(.secondary)
                Text("No filmography available")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, AppTheme.Spacing.xxl)
        }
    }

    // MARK: - Close

    private var closeButton: some View {
        Button {
            dismiss()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.primary)
                .frame(width: 28, height: 28)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(AppTheme.glassBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(AppTheme.Spacing.md)
    }

    // MARK: - Load

    /// Fetch the profile + filmography in parallel, fault-tolerant: either failing
    /// just leaves its section empty rather than blanking the sheet.
    private func load() async {
        guard let service = appState.metadataService else {
            isLoading = false
            return
        }
        async let profile = try? service.getPerson(personId: personId)
        async let filmography = try? service.getPersonCredits(personId: personId)
        let (fetchedPerson, fetchedCredits) = await (profile, filmography)
        if let fetchedPerson { person = fetchedPerson }
        if let fetchedCredits { credits = Array(fetchedCredits.prefix(40)) }
        isLoading = false
    }
}
