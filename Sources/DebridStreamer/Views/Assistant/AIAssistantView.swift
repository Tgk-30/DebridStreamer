import SwiftUI

struct AIAssistantView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = AIAssistantViewModel()

    var body: some View {
        VStack(spacing: 14) {
            header
            promptComposer
            contextControls
            actionBar
            if let status = viewModel.statusMessage {
                Text(status)
                    .font(.caption)
                    .foregroundStyle(status.contains("unavailable") ? .orange : .secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            resultsPane
        }
        .padding(16)
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

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Personalized Movie Assistant")
                .font(.title2)
                .fontWeight(.bold)
            Text("Uses your folders, watch history recency, and taste profile when personalization is enabled.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var promptComposer: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Ask for curated recommendations")
                    .font(.headline)
                Spacer()
                if viewModel.isGenerating {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            TextEditor(text: $viewModel.prompt)
                .font(.body)
                .frame(height: 110)
                .padding(8)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(viewModel.quickPromptChips, id: \.self) { chip in
                        Button(chip) { viewModel.applyQuickPrompt(chip) }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                }
            }
        }
    }

    private var contextControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle("Compare Mode (multi-model + consensus merge)", isOn: $viewModel.compareMode)

            HStack(alignment: .top, spacing: 10) {
                Text("Providers")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .frame(width: 70, alignment: .leading)

                HStack(spacing: 8) {
                    ForEach(AIProviderKind.allCases) { provider in
                        let selected = viewModel.selectedProviders.contains(provider)
                        Button {
                            viewModel.toggleProvider(provider)
                        } label: {
                            Text(provider.displayName)
                                .font(.caption)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(selected ? Color.accentColor.opacity(0.24) : Color.secondary.opacity(0.14))
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var actionBar: some View {
        HStack(spacing: 10) {
            Button {
                Task { await viewModel.generateRecommendations(manager: appState.aiAssistantManager) }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "wand.and.stars")
                    Text("Generate")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isGenerating || viewModel.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Button("Clear") {
                viewModel.clear()
            }
            .buttonStyle(.bordered)

            Spacer()

            Button("Use Current Folder Context") {
                viewModel.contextFolderId = appState.selectedLibraryFolderId
            }
            .buttonStyle(.borderless)
        }
    }

    @ViewBuilder
    private var resultsPane: some View {
        if let result = viewModel.compareResult {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if !result.usedContext.isEmpty {
                        contextPanel(result.usedContext)
                    }
                    mergedSection(result)
                    providerSection(result)
                }
            }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 34))
                    .foregroundStyle(.secondary)
                Text("Ask for recommendations to see personalized results.")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func contextPanel(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Used Context")
                .font(.headline)
            ForEach(items.prefix(8), id: \.self) { value in
                Text("• \(value)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private func mergedSection(_ result: AICompareResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Top Recommendations")
                .font(.headline)

            ForEach(result.mergedRecommendations) { recommendation in
                VStack(alignment: .leading, spacing: 3) {
                    Text(recommendation.title + (recommendation.year.map { " (\($0))" } ?? ""))
                        .fontWeight(.semibold)
                    Text(recommendation.reason)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    @ViewBuilder
    private func providerSection(_ result: AICompareResult) -> some View {
        if viewModel.compareMode {
            VStack(alignment: .leading, spacing: 8) {
                Text("Model Breakdown")
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
                                Text("• " + recommendation.title)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }
}

