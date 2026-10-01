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

/// The live scanner with a typed-code fallback; hands over each code it gets. Whoever
/// resolves the code drives `busy` and `message`; "Escanear otro" calls `onRetry` and rearms the camera.
struct BarcodeCapture: View {
    var busy = false
    var message: String?
    var onRetry: () -> Void = {}
    let onCode: (String) -> Void
    @State private var typed = ""
    @State private var scanKey = 0

    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                if BarcodeScanner.isAvailable {
                    BarcodeScanner(onCode: onCode)
                        .id(scanKey)
                } else {
                    ContentUnavailableView("Cámara no disponible", systemImage: "barcode.viewfinder",
                                           description: Text("Escribe el código de barras debajo."))
                }
                if busy { ProgressView().controlSize(.large).padding().background(.thinMaterial, in: .circle) }
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
            .frame(maxHeight: 360)

            if let message {
                Label(message, systemImage: "exclamationmark.magnifyingglass")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button("Escanear otro") { onRetry(); scanKey += 1 }
            }

            HStack {
                TextField("Código (EAN)", text: $typed)
                    .keyboardType(.numberPad)
                    .textFieldStyle(.roundedBorder)
                Button("Buscar") { onCode(typed.filter(\.isNumber)) }
                    .buttonStyle(.glassProminent)
                    .disabled(typed.filter(\.isNumber).count < 8 || busy)
            }
            Spacer()
        }
        .padding()
    }
}

/// Scan → engine lookup (Open Food Facts) → portion picker. Typing the code works too.
struct BarcodeScanView: View {
    let store: NutritionStore
    @Environment(\.dismiss) private var dismiss
    @State private var product: FoodProduct?
    @State private var looking = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Group {
                if let product {
                    PortionPicker(product: product, store: store) { dismiss() }
                } else {
                    BarcodeCapture(busy: looking, message: message, onRetry: { message = nil }) { code in Task { await lookup(code) } }
                }
            }
            .navigationTitle(product == nil ? "Escanear" : "Porción")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { dismiss() } }
            }
        }
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

/// The amount in g, or ml for a drink, with presets from the label ("Lata (355 ml)") → macros → log.
/// A preset that is a measure people say is stored as said, so the day reads "1 lata · 355 ml".
struct PortionPicker: View {
    let product: FoodProduct
    let store: NutritionStore
    let onDone: () -> Void
    @State private var amount: Double
    /// Set while the amount is a preset measure; typing another amount clears it.
    @State private var measure: Measure?
    @State private var slot: MealSlot
    @State private var saving = false
    /// "una cucharada", "la mitad": the engine turns it into an amount.
    @State private var said = ""
    @State private var estimate: PortionEstimate?
    @State private var estimating = false
    @State private var estimateError: String?
    /// The words last sent, so a submit right after the debounce doesn't ask twice.
    @State private var asked: String?

    init(product: FoodProduct, store: NutritionStore, onDone: @escaping () -> Void) {
        self.product = product
        self.store = store
        self.onDone = onDone
        let portion = product.defaultPortion
        let hour = Calendar.current.component(.hour, from: .now)
        _amount = State(initialValue: portion.amount)
        _measure = State(initialValue: portion.measure)
        _slot = State(initialValue: product.isLiquid ? .forDrink(hour: hour) : .forHour(hour))
    }

    private var unit: String { product.unit.rawValue }
    private var macros: NutritionMacros { product.macros(grams: amount) }

    var body: some View {
        Form {
            Section {
                HStack(spacing: 12) {
                    AsyncImage(url: product.imageUrl.flatMap(URL.init(string:))) { image in
                        image.resizable().scaledToFit()
                    } placeholder: {
                        Image(systemName: product.isLiquid ? "waterbottle" : "shippingbox").foregroundStyle(.secondary)
                    }
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading) {
                        Text(product.name).font(.headline)
                        if let brand = product.brand { Text(brand).font(.subheadline).foregroundStyle(.secondary) }
                        Text("\(Int(product.per100g.kcal)) kcal por 100 \(unit)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section {
                HStack {
                    TextField("«una cucharada», «la mitad», «3 galletas»", text: $said)
                        .submitLabel(.done)
                        .onSubmit { Task { await estimatePortion() } }
                    if estimating {
                        ProgressView()
                    } else if estimate != nil {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(Theme.body)
                            .transition(.symbolEffect(.drawOn))
                    }
                }
                .animation(.snappy, value: estimating)
                .animation(.snappy, value: estimate)
            } header: {
                Text("Cuánto comiste")
            } footer: {
                if let estimateError {
                    Label(estimateError, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                } else if let estimate {
                    Label(estimate.assumption, systemImage: "sparkles")
                }
            }
            .task(id: said) {
                try? await Task.sleep(for: .milliseconds(900))
                guard !Task.isCancelled else { return }
                await estimatePortion()
            }
            Section {
                HStack {
                    TextField(unit, value: $amount, format: .number.precision(.fractionLength(0...1)))
                        .keyboardType(.decimalPad)
                        .font(.title2.weight(.semibold).monospacedDigit()).fontDesign(.rounded)
                    Text(unit).foregroundStyle(.secondary)
                    Stepper("Cantidad", onIncrement: { step(1) }, onDecrement: { step(-1) }).labelsHidden()
                }
                // Presets outgrow the row at large text; they scroll rather than squeeze.
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(product.portions) { portion in
                            Button(portion.title) {
                                measure = portion.measure
                                amount = portion.amount
                            }
                            .tint(portion.amount == amount ? Theme.energy : nil)
                        }
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
                    .lineLimit(1)
                }
                .scrollClipDisabled()
            } header: {
                Text("Cantidad")
            } footer: {
                if let measure { Text(foodAmountText(amount, product.unit, measure: measure)) }
            }
            .onChange(of: amount) { _, new in
                // The estimate's measure stands for its own quantity even if rounding differs.
                if measure?.quantity.amount != new && estimate?.quantity != new { measure = nil }
                if let estimate, estimate.quantity != new { self.estimate = nil }
            }
            Section("Comida") {
                Picker("Momento", selection: $slot) {
                    ForEach(MealSlot.allCases) { Text($0.title).tag($0) }
                }
            }
            Section {
                HStack {
                    Text("\(Int(macros.kcal)) kcal").font(.headline).foregroundStyle(Theme.energy).lineLimit(1)
                        .contentTransition(.numericText(value: macros.kcal))
                        .animation(.snappy, value: macros.kcal)
                    Spacer(minLength: 8)
                    MacroLine(macros: macros)
                }
                Button {
                    Task {
                        saving = true
                        let input = MealInput(name: product.name, slot: slot, quantity: amount, unit: product.unit, macros: macros,
                                              source: "barcode", barcode: product.barcode, measure: measure)
                        if await store.log(input) { onDone() }
                        saving = false
                    }
                } label: {
                    Text("Registrar").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .disabled(amount <= 0 || saving)
            }
        }
        .sensoryFeedback(.selection, trigger: amount)
        .sensoryFeedback(trigger: estimate) { _, new in new == nil ? nil : .success }
    }

    /// Asks the engine what the words come to and moves the amount (and its measure) there.
    private func estimatePortion() async {
        let words = said.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else {
            estimate = nil
            estimateError = nil
            asked = nil
            return
        }
        guard words != asked else { return }
        asked = words
        estimating = true
        defer { estimating = false }
        do {
            guard let found = try await store.estimatePortion(product.barcode, amount: words),
                  words == said.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            estimateError = nil
            estimate = found
            measure = found.measure
            amount = found.quantity
        } catch {
            asked = nil
            guard words == said.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            estimate = nil
            if (error as? PulsoAPI.Failure)?.kind == .unpaired { PulsoModel.shared.handle(error) }
            estimateError = error.localizedDescription
        }
    }

    /// Half a can or bottle at a time while on one; 50 ml or 5 g otherwise.
    private func step(_ direction: Double) {
        if var current = measure {
            current.amount = max(0.5, current.amount + direction * 0.5)
            measure = current
            amount = current.quantity.amount
        } else {
            amount = min(5000, max(0, amount + direction * (product.isLiquid ? 50 : 5)))
        }
    }
}

#Preview("Porción · bebida") {
    NavigationStack {
        PortionPicker(product: FoodProduct(barcode: "1", name: "Coca-Cola", brand: "Coca-Cola",
                                           per100g: NutritionMacros(kcal: 42, protein: 0, carbs: 10.6, fat: 0, fiber: 0),
                                           servingGrams: nil, imageUrl: nil, liquid: true, packageSize: 600, packageKind: "botella"),
                      store: NutritionStore()) {}
    }
}
