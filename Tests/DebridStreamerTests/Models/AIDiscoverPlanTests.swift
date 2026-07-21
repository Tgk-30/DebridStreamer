import Testing
import Foundation
@testable import DebridStreamer

@Suite("AIDiscoverPlan Tests")
struct AIDiscoverPlanTests {
    @Test("filters maps plan fields and page")
    func filtersMapsFieldsToDiscoverFilters() {
        let plan = AIDiscoverPlan(
            mediaType: .movie,
            genreIds: [18, 28],
            keywordIds: [102, 88],
            keywordNames: ["space", "future"],
            yearGTE: 2010,
            yearLTE: 2020,
            minRating: 7.0,
            sortBy: .ratingDesc,
            summary: "Sci-fi favorites"
        )

        let filters = plan.filters(page: 3)

        #expect(filters.minRating == 7.0)
        #expect(filters.sortBy == .ratingDesc)
        #expect(filters.page == 3)
        #expect(filters.genreIds == [18, 28])
        #expect(filters.keywordIds == [102, 88])
        #expect(filters.yearGTE == 2010)
        #expect(filters.yearLTE == 2020)
    }

    @Test("isEmpty identifies plans with no constraints")
    func isEmptyWhenNoConstraints() {
        let emptyPlan = AIDiscoverPlan(
            mediaType: .movie,
            genreIds: [],
            keywordIds: [],
            keywordNames: [],
            yearGTE: nil,
            yearLTE: nil,
            minRating: nil,
            sortBy: .popularityDesc,
            summary: "Default"
        )

        #expect(emptyPlan.isEmpty)

        let partialPlan = AIDiscoverPlan(
            mediaType: .movie,
            genreIds: [1],
            keywordIds: [],
            keywordNames: [],
            yearGTE: nil,
            yearLTE: nil,
            minRating: nil,
            sortBy: .popularityDesc,
            summary: "Genre constrained"
        )

        #expect(partialPlan.isEmpty == false)
    }

    @Test("prompt includes vibe and normalized genre list")
    func promptIncludesVibeAndGenres() {
        let prompt = AIDiscoverPlanParser.prompt(for: "quiet mysteries", genreNames: ["Mystery", "Drama"])

        #expect(prompt.contains("\"quiet mysteries\""))
        #expect(prompt.contains("Mystery, Drama"))
        #expect(prompt.contains("\"movie\"|\"tv\""))
        #expect(prompt.contains("Return ONLY a JSON object"))
    }

    @Test("parse strips code fences and decodes JSON")
    func parseDecodesCodeFencePayload() {
        let payload = """
        preface text
        ```json
        {"mediaType":"tv","genres":["Drama","Mystery"],"keywords":["amnesia"],"yearFrom":2015,"yearTo":2022,"minRating":7.5,"sortBy":"vote_average.desc","summary":"Dark TV for late-night moods"}
        ```
        """
        let raw = AIDiscoverPlanParser.parse(payload)
        #expect(raw != nil)

        guard let raw else {
            return
        }
        #expect(raw.mediaType == "tv")
        #expect(raw.genres == ["Drama", "Mystery"])
        #expect(raw.keywords == ["amnesia"])
        #expect(raw.yearFrom == 2015)
        #expect(raw.yearTo == 2022)
        #expect(raw.minRating == 7.5)
        #expect(raw.sortBy == "vote_average.desc")
        #expect(raw.summary == "Dark TV for late-night moods")
    }

    @Test("parse ignores non-JSON text")
    func parseReturnsNilForNonJSON() {
        #expect(AIDiscoverPlanParser.parse("just some markdown without json") == nil)
    }

    @Test("parse handles text with balanced JSON after prose")
    func parseFindsBalancedJSONAfterProse() {
        let text = "We can parse this: {\"mediaType\":\"movie\",\"genres\":[\"Action\"],\"keywords\":[],\"summary\":\"\"} and done"
        let raw = AIDiscoverPlanParser.parse(text)
        #expect(raw != nil)

        guard let raw else {
            return
        }
        #expect(raw.mediaType == "movie")
        #expect(raw.genres == ["Action"])
        #expect(raw.yearFrom == nil)
        #expect(raw.yearTo == nil)
        #expect(raw.summary == "")
    }

    @Test("filters defaults page to 1")
    func filtersDefaultsPageToOne() {
        let plan = AIDiscoverPlan(
            mediaType: .series,
            genreIds: [],
            keywordIds: [7],
            keywordNames: [],
            yearGTE: nil,
            yearLTE: nil,
            minRating: nil,
            sortBy: .titleAsc,
            summary: ""
        )

        #expect(plan.filters().page == 1)
    }
}
