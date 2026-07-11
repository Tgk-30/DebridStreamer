import Testing
import Foundation
@testable import DebridStreamer

@Suite("AIAffinityVerdict Tests")
struct AIAffinityVerdictTests {
    @Test("Confidence is clamped into 0...1 by the initializer")
    func confidenceClampedInInit() {
        #expect(AIAffinityVerdict(verdict: .yes, confidence: 1.5, reasoning: "x").confidence == 1.0)
        #expect(AIAffinityVerdict(verdict: .no, confidence: -0.4, reasoning: "x").confidence == 0.0)
        #expect(AIAffinityVerdict(verdict: .maybe, confidence: 0.42, reasoning: "x").confidence == 0.42)
    }

    @Test("Confidence percentage rounds to a whole number")
    func confidencePercentRounds() {
        #expect(AIAffinityVerdict(verdict: .yes, confidence: 0.826, reasoning: "x").confidencePercent == 83)
        #expect(AIAffinityVerdict(verdict: .no, confidence: 0, reasoning: "x").confidencePercent == 0)
    }
}

@Suite("AIAffinityParser Parse Tests")
struct AIAffinityParserParseTests {
    @Test("Parses a clean JSON verdict")
    func parsesCleanJSON() throws {
        let text = #"{"verdict":"yes","confidence":0.82,"reasoning":"You will probably love this one."}"#
        let verdict = try AIAffinityParser.parse(text)
        #expect(verdict.verdict == .yes)
        #expect(verdict.confidence == 0.82)
        #expect(verdict.reasoning == "You will probably love this one.")
    }

    @Test("Extracts JSON wrapped in code fences and surrounding prose")
    func parsesFencedAndProsyJSON() throws {
        let text = """
        Sure, here is my read for you:
        ```json
        {"verdict":"no","confidence":0.6,"reasoning":"This leans slower than what you usually finish."}
        ```
        Hope that helps!
        """
        let verdict = try AIAffinityParser.parse(text)
        #expect(verdict.verdict == .no)
        #expect(verdict.confidence == 0.6)
    }

    @Test("Confidence outside 0...1 is clamped through the parse path")
    func parseClampsConfidence() throws {
        let high = try AIAffinityParser.parse(#"{"verdict":"maybe","confidence":1.8,"reasoning":"Could go either way."}"#)
        #expect(high.confidence == 1.0)
        let low = try AIAffinityParser.parse(#"{"verdict":"maybe","confidence":-0.3,"reasoning":"Could go either way."}"#)
        #expect(low.confidence == 0.0)
    }

    @Test("An unknown verdict word maps to maybe rather than throwing")
    func unknownVerdictMapsToMaybe() throws {
        let verdict = try AIAffinityParser.parse(#"{"verdict":"absolutely","confidence":0.7,"reasoning":"Strong match for you."}"#)
        #expect(verdict.verdict == .maybe)
    }

    @Test("Missing confidence falls back to a neutral 0.5")
    func missingConfidenceDefaults() throws {
        let verdict = try AIAffinityParser.parse(#"{"verdict":"yes","reasoning":"You should enjoy this."}"#)
        #expect(verdict.confidence == 0.5)
    }

    @Test("Non-JSON output throws a descriptive error")
    func malformedNonJSONThrows() {
        #expect(throws: AIAffinityParser.ParseError.self) {
            try AIAffinityParser.parse("The model declined to answer.")
        }
    }

    @Test("JSON with no reasoning throws instead of showing an empty verdict")
    func missingReasoningThrows() {
        #expect(throws: AIAffinityParser.ParseError.self) {
            try AIAffinityParser.parse(#"{"verdict":"yes","confidence":0.9}"#)
        }
    }
}

@Suite("AIAffinityParser Prompt Tests")
struct AIAffinityParserPromptTests {
    @Test("Prompt includes the title, the JSON instruction, and second-person reasoning ask")
    func promptIncludesTitleAndSchema() {
        let prompt = AIAffinityParser.prompt(
            title: "Inception",
            year: 2010,
            genres: ["Science Fiction", "Thriller"],
            overview: "A thief who steals corporate secrets through dream-sharing technology.",
            contextNotes: ["Liked genres: Science Fiction"],
            alreadyWatchedNote: nil
        )
        #expect(prompt.contains("Inception"))
        #expect(prompt.contains("\"verdict\":\"yes|maybe|no\""))
        #expect(prompt.contains("second person"))
    }

    @Test("Prompt carries the already-watched note and asks the model to acknowledge it")
    func promptCarriesAlreadyWatchedNote() {
        let prompt = AIAffinityParser.prompt(
            title: "Inception",
            year: 2010,
            genres: [],
            overview: nil,
            contextNotes: ["Liked genres: Science Fiction"],
            alreadyWatchedNote: "they marked it watched, their recorded rating was a thumbs up."
        )
        #expect(prompt.contains("they marked it watched, their recorded rating was a thumbs up."))
        #expect(prompt.contains("acknowledge"))
    }

    @Test("Prompt tells the model to be honest about a general read when there are no taste signals")
    func promptFallsBackToGeneralAppealWhenNoSignals() {
        let prompt = AIAffinityParser.prompt(
            title: "Inception",
            year: 2010,
            genres: ["Science Fiction"],
            overview: nil,
            contextNotes: [],
            alreadyWatchedNote: nil
        )
        #expect(prompt.contains("general appeal"))
        #expect(prompt.contains("honest"))
        #expect(prompt.contains("no personal taste signals"))
    }

    @Test("Prompt grounds the verdict in taste signals when they are present")
    func promptGroundsInSignalsWhenPresent() {
        let prompt = AIAffinityParser.prompt(
            title: "Inception",
            year: 2010,
            genres: ["Science Fiction"],
            overview: nil,
            contextNotes: ["Liked genres: Science Fiction", "Watched Interstellar 4d ago at 100%"],
            alreadyWatchedNote: nil
        )
        #expect(prompt.contains("Liked genres: Science Fiction"))
        #expect(prompt.contains("Watched Interstellar 4d ago at 100%"))
        #expect(!prompt.contains("no personal taste signals"))
    }
}
