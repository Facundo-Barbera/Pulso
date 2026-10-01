import SwiftUI
import VisionKit

/// VisionKit's live barcode scanner. Calls `onCode` once with the first EAN/UPC it recognizes.
struct BarcodeScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    static var isAvailable: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.ean8, .ean13, .upce, .itf14])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

    static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) {
        controller.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        private var delivered = false

        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !delivered else { return }
            for case let .barcode(barcode) in items {
                guard let code = barcode.payloadStringValue?.filter(\.isNumber), (8...14).contains(code.count) else { continue }
                delivered = true
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                onCode(code)
                return
            }
        }
    }
}

/// Scan → engine lookup (Open Food Facts) → portion picker. Typing the code works too.
struct BarcodeScanView: View {
    let store: NutritionStore
    @Environment(\.dismiss) private var dismiss
    @State private var product: FoodProduct?
    @State private var looking = false
    @State private var message: String?
    @State private var typed = ""
    @State private var scanKey = 0

    var body: some View {
        NavigationStack {
            Group {
                if let product {
                    PortionPicker(product: product, store: store) { dismiss() }
                } else {
                    scanner
                }
            }
            .navigationTitle(product == nil ? "Escanear" : "Porción")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { dismiss() } }
            }
        }
    }

    private var scanner: some View {
        VStack(spacing: 16) {
            ZStack {
                if BarcodeScanner.isAvailable {
                    BarcodeScanner { code in Task { await lookup(code) } }
                        .id(scanKey)
                } else {
                    ContentUnavailableView("Cámara no disponible", systemImage: "barcode.viewfinder",
                                           description: Text("Escribe el código de barras debajo."))
                }
                if looking { ProgressView().controlSize(.large).padding().background(.thinMaterial, in: .circle) }
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
            .frame(maxHeight: 360)

            if let message {
                Label(message, systemImage: "exclamationmark.magnifyingglass")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button("Escanear otro") { self.message = nil; scanKey += 1 }
            }

            HStack {
                TextField("Código (EAN)", text: $typed)
                    .keyboardType(.numberPad)
                    .textFieldStyle(.roundedBorder)
                Button("Buscar") { Task { await lookup(typed) } }
                    .buttonStyle(.glassProminent)
                    .disabled(typed.count < 8 || looking)
            }
            Spacer()
        }
        .padding()
    }

    private func lookup(_ code: String) async {
        looking = true
        message = nil
        defer { looking = false }
        do {
            if let found = try await store.lookup(code) {
                product = found
            } else {
                message = "No encontré el código \(code) en Open Food Facts."
            }
        } catch {
            message = error.localizedDescription
        }
    }
}

/// Grams (or servings, when the label gives a serving size) → macros → log.
struct PortionPicker: View {
    let product: FoodProduct
    let store: NutritionStore
    let onDone: () -> Void
    @State private var grams: Double
    @State private var slot = MealSlot.forHour(Calendar.current.component(.hour, from: .now))
    @State private var saving = false

    init(product: FoodProduct, store: NutritionStore, onDone: @escaping () -> Void) {
        self.product = product
        self.store = store
        self.onDone = onDone
        _grams = State(initialValue: product.servingGrams ?? 100)
    }

    private var macros: NutritionMacros { product.macros(grams: grams) }

    var body: some View {
        Form {
            Section {
                HStack(spacing: 12) {
                    AsyncImage(url: product.imageUrl.flatMap(URL.init(string:))) { image in
                        image.resizable().scaledToFit()
                    } placeholder: {
                        Image(systemName: "shippingbox").foregroundStyle(.secondary)
                    }
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading) {
                        Text(product.name).font(.headline)
                        if let brand = product.brand { Text(brand).font(.subheadline).foregroundStyle(.secondary) }
                        Text("\(Int(product.per100g.kcal)) kcal / 100 g").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section("Cantidad") {
                HStack {
                    TextField("g", value: $grams, format: .number.precision(.fractionLength(0...1)))
                        .keyboardType(.decimalPad)
                        .font(.title2.weight(.semibold).monospacedDigit())
                    Text("g").foregroundStyle(.secondary)
                    Stepper("", value: $grams, in: 0...2000, step: 5).labelsHidden()
                }
                HStack {
                    if let serving = product.servingGrams {
                        preset("1 porción", serving)
                        preset("½", serving / 2)
                    }
                    preset("100 g", 100)
                    preset("30 g", 30)
                }
                .buttonStyle(.glass)
                .controlSize(.small)
            }
            Section("Comida") {
                Picker("Momento", selection: $slot) {
                    ForEach(MealSlot.allCases) { Text($0.title).tag($0) }
                }
            }
            Section {
                HStack {
                    Text("\(Int(macros.kcal)) kcal").font(.headline).foregroundStyle(Theme.energy)
                    Spacer()
                    MacroLine(macros: macros)
                }
                Button {
                    Task {
                        saving = true
                        let input = MealInput(name: product.name, slot: slot, quantity: grams, unit: .g, macros: macros,
                                              source: "barcode", barcode: product.barcode)
                        if await store.log(input) { onDone() }
                        saving = false
                    }
                } label: {
                    Text("Registrar").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .disabled(grams <= 0 || saving)
            }
        }
    }

    private func preset(_ title: String, _ value: Double) -> some View {
        Button(title) { grams = (value * 10).rounded() / 10 }
    }
}
