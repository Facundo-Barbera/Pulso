import SwiftUI

/// Manual entry, and the confirmation step after a QR: every value editable before it is saved.
struct BodyScanForm: View {
    let store: BodyStore
    @State private var draft: BodyScan
    @State private var saving = false
    @Environment(\.dismiss) private var dismiss
    private let fromQR: Bool

    init(store: BodyStore, scan: BodyScan?) {
        self.store = store
        fromQR = scan != nil
        _draft = State(initialValue: scan ?? BodyScan(measuredAt: Date.now.timeIntervalSince1970 * 1000))
    }

    private typealias Field = (String, WritableKeyPath<BodyScan, Double?>, String)

    private let main: [Field] = [
        ("Peso", \.weight, "kg"),
        ("Músculo esquelético", \.skeletalMuscleMass, "kg"),
        ("Grasa corporal", \.bodyFatMass, "kg"),
        ("Porcentaje de grasa", \.percentBodyFat, "%"),
    ]
    private let more: [Field] = [
        ("IMC", \.bmi, "kg/m²"),
        ("Grasa visceral", \.visceralFatLevel, "nivel"),
        ("Metabolismo basal", \.bmr, "kcal"),
        ("Agua corporal", \.totalBodyWater, "L"),
        ("ECW/TBW", \.ecwRatio, ""),
        ("Puntuación InBody", \.inbodyScore, "pts"),
        ("Proteína", \.protein, "kg"),
        ("Minerales", \.mineral, "kg"),
        ("Cintura/cadera", \.waistHipRatio, ""),
    ]

    private var date: Binding<Date> {
        Binding { draft.date } set: { draft.measuredAt = $0.timeIntervalSince1970 * 1000 }
    }

    private var canSave: Bool {
        let core = [draft.weight, draft.skeletalMuscleMass, draft.bodyFatMass, draft.percentBodyFat].compactMap { $0 }
        return draft.weight != nil || core.count >= 2
    }

    var body: some View {
        Form {
            if fromQR {
                Section {
                    Label {
                        Text("Revisa los valores antes de guardar. Completa lo que el QR no trae, como la grasa visceral o la puntuación.")
                    } icon: {
                        Image(systemName: "qrcode.viewfinder").foregroundStyle(Theme.body)
                    }
                    .font(.subheadline)
                }
            }
            Section {
                DatePicker("Fecha", selection: date, in: ...Date.now)
                ForEach(main, id: \.0) { row($0) }
            } header: {
                Text("Composición")
            } footer: {
                Text("Con peso y uno de los dos valores de grasa, Pulso calcula el otro.")
            }
            Section("Más valores") {
                ForEach(more, id: \.0) { row($0) }
            }
        }
        .fontDesign(.rounded)
        .navigationTitle(fromQR ? "Tu InBody" : "Nueva medición")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancelar", systemImage: "xmark", role: .cancel) { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Guardar", systemImage: "checkmark") {
                    saving = true
                    Task {
                        if await store.save(draft) { dismiss() }
                        saving = false
                    }
                }
                .buttonStyle(.glassProminent)
                .tint(Theme.body)
                .disabled(!canSave || saving)
            }
        }
    }

    private func row(_ field: Field) -> some View {
        let (title, key, unit) = field
        return HStack {
            Text(title)
            Spacer()
            TextField("—", value: $draft[dynamicMember: key], format: .number)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .frame(maxWidth: 110)
            Text(unit).foregroundStyle(.secondary).frame(width: 44, alignment: .leading).font(.footnote)
        }
    }
}
