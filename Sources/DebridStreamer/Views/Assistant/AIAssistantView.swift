import SwiftUI

struct AIAssistantView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = AIAssistantViewModel()

    var body: some View {
        HStack(spacing: 0) {
            composePane
            Divider()
            resultsPane
        }
        .navigationTitle("AI Assistant")
        .task {
            await viewModel.initialize(
                manager: appState.aiAssistantManager,
                settings: appState.settingsManager,
                draftedPrompt: appState.assistantDraftPrompt
            )
            appState.assistantDraftPrompt = ""
            viewModel.contextFolderId = appState.selectedLibraryFolderId
        }
    }

    private var composePane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Personalized Movie Assistant")
                        .font(.title2.weight(.bold))
                    Text("Use your library, watch history, and folder context to generate ranked picks with transparent reasoning.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))

                VStack(alignment: .leading, spacing: 10) {
                    Text("Prompt")
                        .font(.headline)
                    ZStack(alignment: .topLeading) {
                        if viewModel.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text("Ask for recommendations, tone matching, mood-based picks, or sequel-ready series.")
                                .foregroundStyle(.secondary)
                                .padding(.top, 8)
                                .padding(.leading, 6)
                        }
                        TextEditor(text: $viewModel.prompt)
                            .font(.body)
                            .frame(minHeight: 130)
                            .scrollContentBackground(.hidden)
                            .padding(4)
                    }
                    .padding(8)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Quick Prompts")
                        .font(.headline)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], spacing: 8) {
                        ForEach(viewModel.quickPromptChips, id: \.self) { chip in
                            Button(chip) { viewModel.applyQuickPrompt(chip) }
                                .buttonStyle(.bordered)
                                .font(.caption)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    Toggle("Compare mode (multi-model + consensus merge)", isOn: $viewModel.compareMode)

                    HStack(alignment: .top, spacing: 8) {
                        Text("Providers")
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 68, alignment: .leading)
                        HStack(spacing: 6) {
                            ForEach(AIProviderKind.allCases) { provider in
                                let selected = viewModel.selectedProviders.contains(provider)
                                Button {
                                    viewModel.toggleProvider(provider)
                                } label: {
                                    Text(provider.displayName)
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(selected ? Color.accentColor.opacity(0.22) : Color.secondary.opacity(0.12))
                                        .clipShape(Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(12)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))

                HStack(spacing: 8) {
                    Button {
                        Task { await viewModel.generateRecommendations(manager: appState.aiAssistantManager) }
                    } label: {
                        HStack(spacing: 6) {
                            if viewModel.isGenerating {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Image(systemName: "wand.and.stars")
                            }
                            Text("Generate")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(viewModel.isGenerating || viewModel.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Button("Use Current Folder") {
                        viewModel.contextFolderId = appState.selectedLibraryFolderId
                    }
                    .buttonStyle(.bordered)

                    Button("Clear") { viewModel.clear() }
                        .buttonStyle(.bordered)
                }

                if let status = viewModel.statusMessage {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(status.contains("disabled") ? .orange : .secondary)
                }
            }
            .padding(14)
        }
        .frame(minWidth: 430, idealWidth: 470)
    }

    @ViewBuilder
    private var resultsPane: some View {
        if let result = viewModel.compareResult {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    summaryBar(result: result)

                    if !result.usedContext.isEmpty {
                        contextPanel(result.usedContext)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Ranked Recommendations")
                            .font(.headline)
                        ForEach(result.mergedRecommendations) { recommendation in
                            recommendationCard(recommendation)
                        }
                    }

                    if viewModel.compareMode {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Per-Provider Breakdown")
                                .font(.headline)
                            ForEach(result.providerResponses, id: \.provider) { response in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(response.provider.displayName)
                                        .fontWeight(.semibold)
                                    if response.recommendations.isEmpty {
                                        Text("No recommendations returned.")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    } else {
                                        ForEach(response.recommendations.prefix(5)) { recommendation in
                                            Text("• \(recommendation.title)")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .padding(10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                            }
                        }
                    }
                }
                .padding(14)
            }
        } else {
            VStack(spacing: 12) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 40))
                    .foregroundStyle(.secondary)
                Text("Generate recommendations to see ranked picks, rationale, and context usage.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 300)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func summaryBar(result: AICompareResult) -> some View {
        HStack(spacing: 10) {
            Label("\(result.mergedRecommendations.count) picks", systemImage: "list.number")
                .font(.caption.weight(.semibold))
            Label(result.usedFallback ? "Fallback" : "AI Live", systemImage: result.usedFallback ? "exclamationmark.triangle" : "bolt.fill")
                .font(.caption.weight(.semibold))
            if viewModel.compareMode {
                Label("\(result.providerResponses.count) providers", systemImage: "square.stack.3d.up")
                    .font(.caption.weight(.semibold))
            }
            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    private func contextPanel(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Used Context")
                .font(.headline)
            ForEach(items.prefix(12), id: \.self) { value in
                Text("• \(value)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    private func recommendationCard(_ recommendation: AIMovieRecommendation) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(recommendation.title + (recommendation.year.map { " (\($0))" } ?? ""))
                    .fontWeight(.semibold)
                Spacer()
                Text(String(format: "%.2f", recommendation.score))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            GeometryReader { geo in
                let width = max(0, min(1, recommendation.score)) * geo.size.width
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.secondary.opacity(0.16))
                    Capsule()
                        .fill(Color.accentColor.opacity(0.7))
                        .frame(width: width)
                }
            }
            .frame(height: 6)
            Text(recommendation.reason)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }
}
