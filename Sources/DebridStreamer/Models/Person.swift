import Foundation

/// A TMDB person (actor, director, crew) shown on the Person/Cast page
/// (Overseerr/Jellyseerr pattern). A lightweight, display-only value type - it is
/// not persisted, so it never touches MediaItem's GRDB encoding.
struct Person: Identifiable, Sendable, Equatable {
    let id: Int
    let name: String
    let biography: String?
    let knownForDepartment: String?
    let profilePath: String?
    let birthday: String?
    let placeOfBirth: String?

    init(
        id: Int,
        name: String,
        biography: String? = nil,
        knownForDepartment: String? = nil,
        profilePath: String? = nil,
        birthday: String? = nil,
        placeOfBirth: String? = nil
    ) {
        self.id = id
        self.name = name
        self.biography = biography
        self.knownForDepartment = knownForDepartment
        self.profilePath = profilePath
        self.birthday = birthday
        self.placeOfBirth = placeOfBirth
    }

    /// Square-ish headshot for the profile header (w185 like the cast helpers).
    var profileURL: URL? {
        guard let profilePath, !profilePath.isEmpty else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/w185\(profilePath)")
    }

    /// Larger portrait for the sheet hero (h632 tall variant).
    var profileLargeURL: URL? {
        guard let profilePath, !profilePath.isEmpty else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/h632\(profilePath)")
    }
}
