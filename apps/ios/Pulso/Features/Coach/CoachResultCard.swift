import SwiftUI

/// "Programa creado · Torso/Pierna · 4 días — Abrir en Entreno": what a tool made
/// in this turn, one tap from the tab where it lives.
struct CoachResultCard: View {
    let result: AgentToolResult
    @State private var opened = 0

    var body: some View {
        let place = CoachResultPlace(tab: result.tab)
        Button {
            opened += 1
            CoachLauncher.shared.show(tab: result.tab)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: place.symbol)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(place.color)
                    .frame(width: 44, height: 44)
                    .background(place.color.opacity(0.16), in: .circle)
                    .symbolEffect(.bounce, value: opened)
                VStack(alignment: .leading, spacing: 3) {
                    Text(result.title).font(.headline)
                    if let detail = result.detail {
                        Text(detail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    Text("Abrir en \(place.name)")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(place.color)
                        .padding(.top, 2)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(14)
            .contentShape(.rect(cornerRadius: Theme.corner))
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(place.color.opacity(0.12)).interactive(), in: .rect(cornerRadius: Theme.corner))
        .sensoryFeedback(.selection, trigger: opened)
        .accessibilityHint("Abre \(place.name)")
    }
}

/// The tab a result opens, as the tab bar names and draws it.
struct CoachResultPlace: Equatable {
    let name: String
    let symbol: String
    let color: Color

    init(tab: String) {
        switch tab {
        case "entreno": (name, symbol, color) = ("Entreno", "dumbbell.fill", Theme.training)
        case "dieta": (name, symbol, color) = ("Dieta", "fork.knife", Theme.carbs)
        case "cuerpo": (name, symbol, color) = ("Cuerpo", "figure", Theme.body)
        default: (name, symbol, color) = ("Hoy", "sun.max.fill", Theme.energy)
        }
    }
}
