import SwiftUI

/// Front and back figures with the worked muscles lit: primary strong,
/// secondary softer, the rest of the body a quiet silhouette.
struct MuscleMapView: View {
    let primary: [Muscle]
    let secondary: [Muscle]

    static let primaryColor = Theme.protein
    static let secondaryColor = Theme.carbs

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 18) {
                figure(BodyMapData.front, label: "Frente")
                figure(BodyMapData.back, label: "Espalda")
            }
            HStack(spacing: 8) {
                if !primary.isEmpty { GlassChip("Principal", systemImage: "circle.fill", tint: Self.primaryColor) }
                if !secondary.isEmpty { GlassChip("Secundario", systemImage: "circle.fill", tint: Self.secondaryColor) }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private func figure(_ polygons: [BodyPolygon], label: String) -> some View {
        VStack(spacing: 6) {
            ZStack {
                BodyShape(polygons: polygons) { _ in true }
                    .fill(Color.secondary.opacity(0.2))
                BodyShape(polygons: polygons) { $0.map(secondary.contains) ?? false }
                    .fill(Self.secondaryColor.gradient)
                BodyShape(polygons: polygons) { $0.map(primary.contains) ?? false }
                    .fill(Self.primaryColor.gradient)
                    .shadow(color: Self.primaryColor.opacity(0.45), radius: 6)
            }
            .aspectRatio(BodyMapData.size, contentMode: .fit)
            Text(label).font(.caption2.weight(.medium)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private var accessibilityText: String {
        var parts: [String] = []
        if !primary.isEmpty { parts.append("Principal: " + primary.map(\.label).formatted(.list(type: .and))) }
        if !secondary.isEmpty { parts.append("Secundario: " + secondary.map(\.label).formatted(.list(type: .and))) }
        return parts.joined(separator: ". ")
    }
}

/// The polygons of one figure that pass `include`, scaled to fit the rect. Also draws the plan's muscle badges.
struct BodyShape: Shape {
    let polygons: [BodyPolygon]
    let include: (Muscle?) -> Bool

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width / BodyMapData.size.width, rect.height / BodyMapData.size.height)
        let dx = rect.minX + (rect.width - BodyMapData.size.width * scale) / 2
        let dy = rect.minY + (rect.height - BodyMapData.size.height * scale) / 2
        var path = Path()
        for polygon in polygons where include(polygon.muscle) {
            let points = stride(from: 0, to: polygon.points.count - 1, by: 2).map {
                CGPoint(x: dx + polygon.points[$0] * scale, y: dy + polygon.points[$0 + 1] * scale)
            }
            path.addLines(points)
            path.closeSubpath()
        }
        return path
    }
}

extension BodyMapData {
    /// Which figures draw `muscle`.
    static func views(of muscle: Muscle) -> (front: Bool, back: Bool) {
        (front.contains { $0.muscle == muscle }, back.contains { $0.muscle == muscle })
    }
}

#Preview("Press de banca") {
    Card {
        CardTitle(text: "Músculos", systemImage: "figure.arms.open")
        MuscleMapView(primary: [.chest], secondary: [.frontDelts, .triceps])
    }
    .padding()
}

#Preview("Peso muerto") {
    MuscleMapView(primary: [.hamstrings, .glutes, .lowerBack], secondary: [.traps, .lats, .forearms, .quads, .adductors])
        .padding()
        .preferredColorScheme(.light)
}
