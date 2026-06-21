import Foundation

/// A single cast member for a movie or TV show (L23 — Detail cast row).
/// A lightweight, display-only value type derived from TMDB credits; it is not
/// persisted, so it never touches MediaItem's GRDB encoding.
struct CastMember: Identifiable, Sendable, Equatable {
    let id: Int
    let name: String
    let character: String
    let profileURL: URL?

    init(id: Int, name: String, character: String, profilePath: String?) {
        self.id = id
        self.name = name
        self.character = character
        if let path = profilePath, !path.isEmpty {
            self.profileURL = URL(string: "https://image.tmdb.org/t/p/w185\(path)")
        } else {
            self.profileURL = nil
        }
    }
}
