import CoreImage
import SwiftUI

/// The colour-vision deficiencies a preview can simulate: Machado, Oliveira & Fernandes (2009)
/// at full severity, applied in linear RGB (Core Image's working space).
enum ColorBlindness: String, CaseIterable {
    case deuteranopia, protanopia, tritanopia

    fileprivate var rows: [CIVector] {
        switch self {
        case .deuteranopia: [CIVector(x: 0.367322, y: 0.860646, z: -0.227968, w: 0), CIVector(x: 0.280085, y: 0.672501, z: 0.047413, w: 0), CIVector(x: -0.011820, y: 0.042940, z: 0.968881, w: 0)]
        case .protanopia: [CIVector(x: 0.152286, y: 1.052583, z: -0.204868, w: 0), CIVector(x: 0.114503, y: 0.786281, z: 0.099216, w: 0), CIVector(x: -0.003882, y: -0.048116, z: 1.051998, w: 0)]
        case .tritanopia: [CIVector(x: 1.255528, y: -0.076749, z: -0.178779, w: 0), CIVector(x: -0.078411, y: 0.930809, z: 0.147602, w: 0), CIVector(x: 0.004733, y: 0.691367, z: 0.303900, w: 0)]
        }
    }
}

/// Shows `content` as someone with `kind` would see it, for #Previews: put a screen next to its
/// simulated twin to check that nothing depends on hue alone. Renders a still image; not for shipping UI.
struct ColorBlindnessPreview<Content: View>: View {
    let kind: ColorBlindness
    var width: CGFloat = 375
    @ViewBuilder var content: Content

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        if let image = simulated() {
            Image(uiImage: image).resizable().scaledToFit().frame(width: width)
        }
    }

    private func simulated() -> UIImage? {
        let renderer = ImageRenderer(content: content.frame(width: width).environment(\.colorScheme, colorScheme))
        renderer.scale = displayScale
        guard let cgImage = renderer.cgImage, let filter = CIFilter(name: "CIColorMatrix") else { return nil }
        filter.setValue(CIImage(cgImage: cgImage), forKey: kCIInputImageKey)
        zip(["inputRVector", "inputGVector", "inputBVector"], kind.rows).forEach { filter.setValue($1, forKey: $0) }
        guard let output = filter.outputImage, let result = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: result, scale: displayScale, orientation: .up)
    }
}

#Preview("Paleta · normal y simulada") {
    let swatches: [(String, Color)] = [
        ("kcal", Theme.energy), ("Proteína", Theme.protein), ("Carbos", Theme.carbs), ("Grasa", Theme.fat),
        ("Cuerpo", Theme.body), ("Entreno", Theme.training), ("Bien", Theme.good), ("Ojo", Theme.caution),
    ]
    let row = HStack(spacing: 6) {
        ForEach(swatches, id: \.0) { name, color in
            VStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 6).fill(color).frame(height: 36)
                Text(name).font(.caption2).lineLimit(1).minimumScaleFactor(0.6)
            }
        }
    }
    NarrowPreview {
        Text("Normal").font(.caption.weight(.semibold)).frame(maxWidth: .infinity, alignment: .leading)
        row
        ForEach(ColorBlindness.allCases, id: \.self) { kind in
            Text(kind.rawValue.capitalized).font(.caption.weight(.semibold)).frame(maxWidth: .infinity, alignment: .leading)
            ColorBlindnessPreview(kind: kind, width: 343) { row }
        }
    }
}
