import Foundation

/// The AI's answer to "Would I like this?" for a single title: a verdict
/// (yes / maybe / no), a confidence in 0...1, and a short reasoning paragraph
/// addressed to the user. Grounded in the user's taste profile, ratings, and
/// watch history when personalization is on; otherwise a general-appeal read.
struct AIAffinityVerdict: Sendable, Equatable {
    enum Verdict: String, Sendable, Equatable {
        case yes
        case maybe
        case no
    }

    let verdict: Verdict
    /// Model confidence, always clamped into 0...1 by the initializer.
    let confidence: Double
    let reasoning: String

    init(verdict: Verdict, confidence: Double, reasoning: String) {
        self.verdict = verdict
        self.confidence = min(max(confidence, 0), 1)
        self.reasoning = reasoning
    }

    /// Confidence as a whole-number percentage for display (0.82 -> 82).
    var confidencePercent: Int {
        Int((confidence * 100).rounded())
    }
}

/// Parser + prompt for the affinity ("Would I like this?") step. Reuses the same
/// balanced-JSON extraction strategy as `AIAssistantJSONParser` (code-fence
/// stripping + brace counting) so a model that wraps its JSON in prose or fences
/// still parses. Tolerant of an unknown verdict word (maps it to `.maybe`) but
/// throws a descriptive error when there is no usable JSON or no reasoning.
enum AIAffinityParser {
    /// Descriptive parse failure surfaced to the UI when the model's reply cannot
    /// be turned into an honest verdict.
    struct ParseError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// The raw shape the model is asked to emit.
    struct RawVerdict: Decodable {
        let verdict: String?
        let confidence: Double?
        let reasoning: String?
    }

    /// Instruction sent to the model. The taste signals in `contextNotes` ground
    /// the verdict; when they are empty (personalization off or no signals yet)
    /// the model is told to fall back to general appeal and admit that honestly.
    /// When the user has already watched or rated the title, `alreadyWatchedNote`
    /// asks the model to factor that in and acknowledge it.
    static func prompt(
        title: String,
        year: Int?,
        genres: [String],
        overview: String?,
        contextNotes: [String],
        alreadyWatchedNote: String?
    ) -> String {
        let yearSuffix = year.map { " (\($0))" } ?? ""
        let genreLine = genres.isEmpty ? "unknown" : genres.joined(separator: ", ")
        let trimmedOverview = overview?.trimmingCharacters(in: .whitespacesAndNewlines)
        let overviewLine = (trimmedOverview?.isEmpty == false) ? trimmedOverview! : "Not available."

        var lines: [String] = []
        lines.append("You help a viewer decide whether they would enjoy a specific title.")
        lines.append("Title: \(title)\(yearSuffix)")
        lines.append("Genres: \(genreLine)")
        lines.append("Overview: \(overviewLine)")

        if let alreadyWatchedNote, !alreadyWatchedNote.isEmpty {
            lines.append("")
            lines.append("The viewer has already engaged with this title: \(alreadyWatchedNote)")
            lines.append("Factor that in and acknowledge it directly in your reasoning.")
        }

        lines.append("")
        if contextNotes.isEmpty {
            lines.append("You have no personal taste signals for this viewer.")
            lines.append("Base your verdict on the title's general appeal, and say honestly in the reasoning that this is a general read rather than one tailored to their taste.")
        } else {
            lines.append("Here is what is known about the viewer's taste, ratings, and watch history:")
            for note in contextNotes.prefix(24) {
                lines.append("- \(note)")
            }
            lines.append("Ground your verdict in these signals and reference the most relevant ones in your reasoning.")
        }

        lines.append("")
        lines.append("Respond ONLY with a JSON object: {\"verdict\":\"yes|maybe|no\",\"confidence\":0.0-1.0,\"reasoning\":\"2-3 sentences addressed to the user in second person\"}")
        lines.append("Do not include any text outside the JSON object.")

        return lines.joined(separator: "\n")
    }

    /// Extract the verdict from the model's raw text. Throws `ParseError` when no
    /// balanced JSON object is present or the reasoning is missing, so the UI can
    /// surface an honest failure instead of a fake verdict.
    static func parse(_ raw: String) throws -> AIAffinityVerdict {
        let stripped = strippingCodeFences(from: raw)
        guard let json = firstBalancedJSONObject(in: stripped),
              let data = json.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(RawVerdict.self, from: data) else {
            throw ParseError(message: "The assistant did not return a readable verdict. Try again.")
        }

        let reasoning = decoded.reasoning?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !reasoning.isEmpty else {
            throw ParseError(message: "The assistant did not explain its verdict. Try again.")
        }

        return AIAffinityVerdict(
            verdict: verdict(from: decoded.verdict),
            confidence: decoded.confidence ?? 0.5,
            reasoning: reasoning
        )
    }

    /// Map the model's verdict word to a case. An unknown or missing word is a
    /// non-committal "maybe" rather than a hard failure.
    private static func verdict(from raw: String?) -> AIAffinityVerdict.Verdict {
        switch raw?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "yes": return .yes
        case "no": return .no
        default: return .maybe
        }
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
