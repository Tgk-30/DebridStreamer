import Testing
import SwiftUI
import AppKit
@testable import DebridStreamer

@Suite("AppTheme Tests")
struct AppThemeTests {
    @Test("qualityColor maps known labels to semantic tokens")
    func qualityColorMapsKnownLabels() {
        #expect(AppTheme.qualityColor("2160p") == AppTheme.accentTertiary)
        #expect(AppTheme.qualityColor("4k") == AppTheme.accentTertiary)
        #expect(AppTheme.qualityColor("UHD") == AppTheme.accentTertiary)

        #expect(AppTheme.qualityColor("1080p") == AppTheme.accentSecondary)
        #expect(AppTheme.qualityColor("720p") == AppTheme.accent)
        #expect(AppTheme.qualityColor("480") == .secondary)
        #expect(AppTheme.qualityColor("sd") == .secondary)
        #expect(AppTheme.qualityColor("something else") == .secondary)
    }

    @Test("seederColor maps seed counts to semantic tokens")
    func seederColorMapsSeederCounts() {
        #expect(AppTheme.seederColor(100) == AppTheme.success)
        #expect(AppTheme.seederColor(50) == AppTheme.success)

        #expect(AppTheme.seederColor(25) == AppTheme.warning)
        #expect(AppTheme.seederColor(10) == AppTheme.warning)

        #expect(AppTheme.seederColor(9) == AppTheme.danger)
        #expect(AppTheme.seederColor(0) == AppTheme.danger)
        #expect(AppTheme.seederColor(-4) == AppTheme.danger)
    }

    @Test("GlassElevation properties expose expected materials and dimensions")
    func glassElevationProperties() {
        #expect(String(describing: GlassElevation.rest.material).contains("ultraThin"))
        #expect(String(describing: GlassElevation.raised.material).contains("regular"))
        #expect(String(describing: GlassElevation.hero.material).contains("thick"))

        #expect(GlassElevation.rest.tintOpacity == 0.08)
        #expect(GlassElevation.raised.tintOpacity == 0.11)
        #expect(GlassElevation.hero.tintOpacity == 0.14)

        #expect(GlassElevation.rest.strokeWidth == 0.75)
        #expect(GlassElevation.raised.strokeWidth == 1)
        #expect(GlassElevation.hero.strokeWidth == 1.25)

        #expect(GlassElevation.rest.shadowRadius == 7)
        #expect(GlassElevation.raised.shadowRadius == 16)
        #expect(GlassElevation.hero.shadowRadius == 28)

        #expect(GlassElevation.rest.shadowY == 3)
        #expect(GlassElevation.raised.shadowY == 10)
        #expect(GlassElevation.hero.shadowY == 18)

        #expect(GlassElevation.rest.shadowOpacity == 0.10)
        #expect(GlassElevation.raised.shadowOpacity == 0.20)
        #expect(GlassElevation.hero.shadowOpacity == 0.28)
    }

    @Test("Theme gradient tokens are constructable")
    func themeTokensCanConstruct() {
        _ = AppTheme.background
        _ = AppTheme.auroraGlow
        _ = AppTheme.heroGradient

        let _ = AppTheme.Spacing.md
        let _ = AppTheme.Radius.card
        let _ = GlassLevel.ultraThin
        let _ = GlassLevel.thin
        let _ = GlassLevel.regular

        #expect(GlassSurface(elevation: .hero).elevation == .hero)
    }

    @Test("glass modifiers and headings can be rendered")
    @MainActor
    func glassModifiersAndHeadersRender() {
        mountForCoverage(
            VStack(spacing: 18) {
                PageHeader(title: "Catalog", subtitle: "Now playing", systemImage: "sparkles")
                Text("Title row")
                    .glassCard(tint: .red)
                Text("Surface row")
                    .glassSurface()
                Text("Panel")
                    .glassPanel(level: .thin, elevated: true)
                Text("Panel with tint")
                    .glassPanel(level: .regular, elevated: false, tint: .blue.opacity(0.12))
                Text("Elevation rest")
                    .glassElevation(.rest, tint: .blue.opacity(0.2))
                Text("Elevation raised")
                    .glassElevation(.raised, radius: 14)
                Text("Elevation hero")
                    .glassElevation(.hero, tint: .green.opacity(0.18))
                Button("Action") {}
                    .buttonStyle(.glass)
                Button("Hero action") {}
                    .buttonStyle(.glassProminent)
                Text("Header without subtitle")
                    .overlay {
                        PageHeader(title: "Plain", systemImage: "play.fill")
                    }
            }
        )
    }

    @Test("aurora glow renders through geometry path")
    @MainActor
    func auroraGlowRendersViaGeometry() {
        mountForCoverage(
            AppTheme.auroraGlow
                .frame(width: 240, height: 120)
        )
    }

    private func mountForCoverage<V: View>(_ view: V) {
        let hosting = NSHostingController(rootView: view)
        _ = hosting.view
        hosting.view.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.001))
    }
}
