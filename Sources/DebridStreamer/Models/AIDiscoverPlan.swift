import Foundation

/// The structured TMDB /discover plan the AI distills a free-text "vibe" into
/// (e.g. "cozy fall mysteries", "mind-bending sci-fi from the 2010s").
///
/// The manager resolves the model's keyword *names* into TMDB keyword ids and
/// genre *names* into genre ids; the view then renders the plan via the existing
/// `discover()` path. A short human-readable `summary` is shown above the result
/// grid so the user can see how their vibe was interpreted.
struct AIDiscoverPlan: Sendable, Equatable {
    var mediaType: MediaType
    var genreIds: [Int]
    var keywordIds: [Int]
    var keywordNames: [String]
    var yearGTE: Int?
    var yearLTE: Int?
    var minRating: Double?
    var sortBy: DiscoverFilters.SortOption
    var summary: String

    /// Build the `DiscoverFilters` the existing `discover()` path consumes.
    func filters(page: Int = 1) -> DiscoverFilters {
        DiscoverFilters(
            minRating: minRating,
            sortBy: sortBy,
            page: page,
            genreIds: genreIds,
            keywordIds: keywordIds,
            yearGTE: yearGTE,
            yearLTE: yearLTE
        )
    }

    /// True when the plan carries no actual constraint (model returned nothing
    /// usable) - the view can fall back to a plain popularity browse + a note.
    var isEmpty: Bool {
        genreIds.isEmpty && keywordIds.isEmpty && yearGTE == nil && yearLTE == nil && minRating == nil
    }
}

/// Parser + prompt for the NL→TMDB-filter step. Reuses the same balanced-JSON
/// extraction strategy as `AIAssistantJSONParser` (code-fence stripping + brace
/// counting) so a model that wraps JSON in prose or fences still parses.
enum AIDiscoverPlanParser {
    /// The raw filter shape the model is asked to emit. Genres + keywords are
    /// returned as *names* (more robust than asking the model to memorize TMDB
    /// numeric ids); the manager resolves them to ids afterwards.
    struct RawPlan: Decodable {
        let mediaType: String?
        let genres: [String]?
        let keywords: [String]?
        let yearFrom: Int?
        let yearTo: Int?
        let minRating: Double?
        let sortBy: String?
        let summary: String?
    }

    /// Instruction sent to the model. Lists the valid TMDB genre names so the
    /// model picks from a known vocabulary (it's free to leave genres empty).
    static func prompt(for vibe: String, genreNames: [String]) -> String {
        let genres = genreNames.joined(separator: ", ")
        return """
        You translate a viewer's mood/vibe into TMDB discover filters.
        Vibe: "\(vibe)"

        Return ONLY a JSON object in this exact schema (omit fields you are unsure of):
        {"mediaType":"movie"|"tv","genres":["..."],"keywords":["..."],"yearFrom":2010,"yearTo":2019,"minRating":7.0,"sortBy":"popularity.desc"|"vote_average.desc"|"primary_release_date.desc","summary":"a short human sentence describing the picks"}

        Rules:
        - Pick genres ONLY from this list: \(genres)
        - keywords are short TMDB-style theme words (e.g. "time travel", "heist", "coming of age", "dystopia"); 1-4 of them.
        - Infer yearFrom/yearTo from any decade or era mentioned ("2010s" -> 2010..2019).
        - Default mediaType to "movie" unless the vibe clearly implies TV.
        - Keep summary under 18 words.
        """
    }

    static func parse(_ text: String) -> RawPlan? {
        let stripped = strippingCodeFences(from: text)
        guard let json = firstBalancedJSONObject(in: stripped),
              let data = json.data(using: .utf8),
              let plan = try? JSONDecoder().decode(RawPlan.self, from: data) else {
            return nil
        }
        return plan
    }

    // MARK: - Shared JSON extraction (mirrors AIAssistantJSONParser)

    private static func strippingCodeFences(from text: String) -> String {
        guard text.contains("```") else { return text }
        var result = text
        if let openRange = result.range(of: #"```[a-zA-Z0-9]*\n?"#, options: .regularExpression) {
            result.removeSubrange(openRange)
        }
        if let closeRange = result.range(of: "```", options: .backwards) {
            result.removeSubrange(closeRange)
        }
        return result
    }

    private static func firstBalancedJSONObject(in text: String) -> String? {
        var startIndex: String.Index?
        var depth = 0
        var inString = false
        var escaped = false

        var index = text.startIndex
        while index < text.endIndex {
            let character = text[index]
            if inString {
                if escaped { escaped = false }
                else if character == "\\" { escaped = true }
                else if character == "\"" { inString = false }
            } else {
                switch character {
                case "\"": inString = true
                case "{":
                    if depth == 0 { startIndex = index }
                    depth += 1
                case "}":
                    if depth > 0 {
                        depth -= 1
                        if depth == 0, let start = startIndex {
                            let end = text.index(after: index)
                            return String(text[start..<end])
                        }
                    }
                default: break
                }
            }
            index = text.index(after: index)
        }
        return nil
    }
}
