import SwiftUI
import AppKit

// MARK: - Adaptive color helper

extension Color {
    /// A color that resolves differently in light vs dark appearance. SwiftUI
    /// materials and semantic colors adapt automatically; this gives the same
    /// for the app's custom brand/aurora/semantic colors (SPM has no asset
    /// catalog, so we build dynamic NSColors by hand).
    static func adaptive(light: Color, dark: Color) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return NSColor(isDark ? dark : light)
        })
    }
}

// MARK: - Design tokens

enum AppTheme {

    // MARK: Spacing scale (4pt grid)
    enum Spacing {
        static let xxs: CGFloat = 2
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
        static let xxxl: CGFloat = 48
    }

    // MARK: Corner-radius scale
    enum Radius {
        static let xs: CGFloat = 6
        static let sm: CGFloat = 10
        static let md: CGFloat = 14
        static let lg: CGFloat = 20
        static let xl: CGFloat = 28
        /// Canonical poster/card radius.
        static let card: CGFloat = 16
        static let pill: CGFloat = 999
    }

    // MARK: Brand + semantic colors (adaptive)

    /// Primary accent — a vibrant indigo/violet that reads as "cinematic".
    static let accent = Color.adaptive(
        light: Color(red: 0.36, green: 0.34, blue: 0.86),
        dark: Color(red: 0.55, green: 0.52, blue: 0.98)
    )
    /// Secondary accent for gradients — a cyan/blue companion.
    static let accentSecondary = Color.adaptive(
        light: Color(red: 0.20, green: 0.55, blue: 0.90),
        dark: Color(red: 0.36, green: 0.74, blue: 0.98)
    )
    /// Tertiary accent — magenta/pink, used sparingly in hero gradients.
    static let accentTertiary = Color.adaptive(
        light: Color(red: 0.85, green: 0.35, blue: 0.62),
        dark: Color(red: 0.98, green: 0.46, blue: 0.74)
    )

    static let success = Color.adaptive(
        light: Color(red: 0.18, green: 0.62, blue: 0.36),
        dark: Color(red: 0.36, green: 0.85, blue: 0.55)
    )
    static let warning = Color.adaptive(
        light: Color(red: 0.85, green: 0.55, blue: 0.12),
        dark: Color(red: 0.98, green: 0.72, blue: 0.36)
    )
    static let danger = Color.adaptive(
        light: Color(red: 0.82, green: 0.24, blue: 0.24),
        dark: Color(red: 0.98, green: 0.45, blue: 0.45)
    )
    static let info = accentSecondary

    /// Hairline border for glass surfaces (kept as `glassBorder` for back-compat).
    static let glassBorder = Color.adaptive(
        light: Color.black.opacity(0.10),
        dark: Color.white.opacity(0.14)
    )
    /// A brighter top edge for a subtle "lit glass" feel.
    static let glassHighlight = Color.adaptive(
        light: Color.white.opacity(0.7),
        dark: Color.white.opacity(0.22)
    )

    // MARK: Backgrounds

    /// App-wide aurora backdrop. Subtle multi-hue depth in dark; soft cool wash in light.
    static var background: LinearGradient {
        LinearGradient(
            colors: [
                Color.adaptive(light: Color(red: 0.96, green: 0.97, blue: 0.99),
                               dark: Color(red: 0.05, green: 0.06, blue: 0.10)),
                Color.adaptive(light: Color(red: 0.93, green: 0.94, blue: 0.98),
                               dark: Color(red: 0.09, green: 0.09, blue: 0.16)),
                Color.adaptive(light: Color(red: 0.95, green: 0.95, blue: 0.98),
                               dark: Color(red: 0.06, green: 0.07, blue: 0.12))
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    /// Soft colored glow overlaid on the background for aurora depth (place in a ZStack
    /// behind content with `.blendMode(.plusLighter)` or low opacity).
    static var auroraGlow: some View {
        GeometryReader { proxy in
            ZStack {
                Circle()
                    .fill(accent.opacity(0.35))
                    .frame(width: proxy.size.width * 0.7)
                    .blur(radius: 140)
                    .offset(x: -proxy.size.width * 0.28, y: -proxy.size.height * 0.32)
                Circle()
                    .fill(accentSecondary.opacity(0.28))
                    .frame(width: proxy.size.width * 0.6)
                    .blur(radius: 150)
                    .offset(x: proxy.size.width * 0.34, y: proxy.size.height * 0.30)
                Circle()
                    .fill(accentTertiary.opacity(0.18))
                    .frame(width: proxy.size.width * 0.5)
                    .blur(radius: 160)
                    .offset(x: proxy.size.width * 0.30, y: -proxy.size.height * 0.36)
            }
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }

    /// Vibrant brand gradient for hero panels.
    static var heroGradient: LinearGradient {
        LinearGradient(
            colors: [accent.opacity(0.85), accentSecondary.opacity(0.7), accentTertiary.opacity(0.55)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    // MARK: Quality + seeder colors (tokenized; were hardcoded per-view)

    static func qualityColor(_ label: String) -> Color {
        let l = label.lowercased()
        if l.contains("2160") || l.contains("4k") || l.contains("uhd") { return accentTertiary }
        if l.contains("1080") { return accentSecondary }
        if l.contains("720") { return accent }
        if l.contains("480") || l.contains("sd") { return .secondary }
        return .secondary
    }

    static func seederColor(_ seeders: Int) -> Color {
        if seeders >= 50 { return success }
        if seeders >= 10 { return warning }
        return danger
    }
}

// MARK: - Glass surfaces

/// Visual weight of a glass surface.
enum GlassLevel {
    case ultraThin, thin, regular

    var material: Material {
        switch self {
        case .ultraThin: return .ultraThinMaterial
        case .thin: return .thinMaterial
        case .regular: return .regularMaterial
        }
    }
}

/// The single, parametric glass panel used everywhere. Replaces the three
/// divergent ad-hoc recipes (different radii / border opacities / materials).
struct GlassPanel: ViewModifier {
    var radius: CGFloat = AppTheme.Radius.md
    var level: GlassLevel = .ultraThin
    var elevated: Bool = true
    var tint: Color? = nil

    func body(content: Content) -> some View {
        content
            .background {
                ZStack {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .fill(level.material)
                    if let tint {
                        RoundedRectangle(cornerRadius: radius, style: .continuous)
                            .fill(tint.opacity(0.16))
                    }
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [AppTheme.glassHighlight, AppTheme.glassBorder],
                            startPoint: .top, endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
            }
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .shadow(color: Color.black.opacity(elevated ? 0.22 : 0),
                    radius: elevated ? 18 : 0, x: 0, y: elevated ? 10 : 0)
    }
}

extension View {
    /// Canonical glass card (posters, result tiles, recommendation cards).
    func glassCard(radius: CGFloat = AppTheme.Radius.card, elevated: Bool = true, tint: Color? = nil) -> some View {
        modifier(GlassPanel(radius: radius, level: .ultraThin, elevated: elevated, tint: tint))
    }

    /// Larger structural panels / side rails.
    func glassPanel(radius: CGFloat = AppTheme.Radius.lg, level: GlassLevel = .regular, elevated: Bool = true, tint: Color? = nil) -> some View {
        modifier(GlassPanel(radius: radius, level: level, elevated: elevated, tint: tint))
    }

    /// Small inline chip / capsule.
    func glassChip() -> some View {
        self
            .background(.thinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(AppTheme.glassBorder, lineWidth: 0.75))
    }

    /// Back-compat alias — existing call sites keep working, now with the unified look.
    func glassSurface() -> some View {
        glassCard()
    }
}

// MARK: - Glass button style

struct GlassButtonStyle: ButtonStyle {
    var prominent: Bool = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.semibold))
            .padding(.horizontal, AppTheme.Spacing.lg)
            .padding(.vertical, AppTheme.Spacing.sm)
            .foregroundStyle(prominent ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background {
                if prominent {
                    Capsule().fill(AppTheme.heroGradient)
                } else {
                    Capsule().fill(.ultraThinMaterial)
                }
            }
            .overlay(Capsule().strokeBorder(AppTheme.glassBorder, lineWidth: prominent ? 0 : 1))
            .clipShape(Capsule())
            .shadow(color: prominent ? AppTheme.accent.opacity(0.35) : .clear, radius: 10, y: 4)
            .opacity(isEnabled ? 1 : 0.5)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == GlassButtonStyle {
    static var glass: GlassButtonStyle { GlassButtonStyle(prominent: false) }
    static var glassProminent: GlassButtonStyle { GlassButtonStyle(prominent: true) }
}

// MARK: - Page header

/// Consistent page header for detail panes — with the hidden title bar, screens
/// otherwise have no visible name (L24).
struct PageHeader: View {
    let title: String
    var subtitle: String? = nil
    var systemImage: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.xxs) {
            HStack(spacing: AppTheme.Spacing.sm) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.title2)
                        .foregroundStyle(AppTheme.accent)
                }
                Text(title)
                    .font(.system(.largeTitle, design: .rounded).weight(.bold))
            }
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
