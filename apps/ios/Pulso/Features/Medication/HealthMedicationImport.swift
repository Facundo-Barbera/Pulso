import HealthKit
import SwiftUI

/// Reads the person's medication list from Apple Health (iOS 26
/// `HKUserAnnotatedMedication`), read-only. Health shares names and forms but
/// not dose times, so imports arrive as "cuando haga falta" for the person to
/// give them a schedule.
enum HealthMedications {
    struct Found: Identifiable, Hashable {
        var id: String
        var name: String
        var form: String?
        var hasSchedule: Bool
    }

    static func fetch() async throws -> [Found] {
        guard HKHealthStore.isHealthDataAvailable() else { return [] }
        let store = HealthSync.store
        // Per-object authorization: Health asks which medications to share, every time.
        try await store.requestPerObjectReadAuthorization(for: .userAnnotatedMedicationType(), predicate: nil)
        let meds = try await HKUserAnnotatedMedicationQueryDescriptor().result(for: store)
        return meds.filter { !$0.isArchived }.enumerated().map { index, med in
            Found(
                // The concept identifier exposes no public code; the list position is enough for one sheet.
                id: "\(index)-\(med.medication.displayText)",
                name: med.nickname ?? med.medication.displayText,
                form: formName(med.medication.generalForm),
                hasSchedule: med.hasSchedule
            )
        }
    }

    static func formName(_ form: HKMedicationGeneralForm) -> String? {
        switch form {
        case .tablet: "comprimido"
        case .capsule: "cápsula"
        case .drops: "gotas"
        case .liquid: "jarabe"
        case .powder: "polvo"
        case .injection: "inyección"
        case .inhaler: "inhalador"
        case .cream, .ointment, .lotion, .gel, .topical: "crema"
        case .patch: "parche"
        case .spray: "spray"
        default: nil
        }
    }

    static func draft(_ found: Found) -> MedicationDraft {
        var draft = MedicationDraft()
        draft.name = found.name
        draft.form = found.form
        draft.unit = found.form ?? "dosis"
        draft.dose = 1
        draft.schedule = .asNeededOnly
        return draft
    }
}

struct HealthMedicationImport: View {
    let store: MedicationStore

    @Environment(\.dismiss) private var dismiss
    @State private var found: [HealthMedications.Found]?
    @State private var selected: Set<String> = []
    @State private var error: String?
    @State private var importing = false

    var body: some View {
        NavigationStack {
            Group {
                if let error {
                    ContentUnavailableView("No se pudo leer Salud", systemImage: "heart.slash", description: Text(error))
                } else if let found, found.isEmpty {
                    ContentUnavailableView(
                        "Nada para importar",
                        systemImage: "heart.text.square",
                        description: Text("No hay medicamentos en Salud, o no compartiste ninguno con Pulso.")
                    )
                } else if let found {
                    List(found) { med in
                        let exists = alreadyAdded(med)
                        Button {
                            if selected.contains(med.id) { selected.remove(med.id) } else { selected.insert(med.id) }
                        } label: {
                            HStack {
                                Image(systemName: selected.contains(med.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selected.contains(med.id) ? Color.accentColor : .secondary)
                                    .contentTransition(.symbolEffect(.replace))
                                VStack(alignment: .leading) {
                                    Text(med.name)
                                    Text(exists ? "Ya está en Pulso" : (med.form?.capitalized ?? "Medicamento"))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(exists)
                    }
                    .safeAreaInset(edge: .bottom) {
                        // On a bar, so the note doesn't sit unreadably over the list rows scrolling under it.
                        Text("Salud no comparte los horarios: añádelos luego en cada medicamento.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                            .background(.bar)
                    }
                } else {
                    ProgressView("Abriendo Salud…")
                }
            }
            .navigationTitle("Importar de Salud")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Importar", role: .confirm) { Task { await importSelected() } }
                        .disabled(selected.isEmpty || importing)
                }
            }
        }
        .task { await load() }
    }

    private func alreadyAdded(_ med: HealthMedications.Found) -> Bool {
        store.medications.contains { $0.name.localizedCaseInsensitiveCompare(med.name) == .orderedSame }
    }

    private func load() async {
        do {
            let meds = try await HealthMedications.fetch()
            found = meds
            selected = Set(meds.filter { !alreadyAdded($0) }.map(\.id))
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func importSelected() async {
        importing = true
        defer { importing = false }
        for med in found ?? [] where selected.contains(med.id) {
            _ = await store.save(HealthMedications.draft(med), id: nil)
        }
        dismiss()
    }
}
