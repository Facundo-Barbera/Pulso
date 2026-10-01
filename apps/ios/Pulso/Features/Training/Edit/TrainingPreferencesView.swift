import SwiftUI

/// The equipment the person prefers, in order. Alternatives and the Coach's programs
/// favour what is on top; turning everything off means no preference.
struct TrainingPreferencesView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var chosen: [String]
    @State private var saving = false
    private let original: [String]

    /// `preferred` is for previews; the app starts from the store's settings.
    init(preferred: [String]? = nil) {
        let start = (preferred ?? TrainingStore.shared.settings.preferredEquipment).filter(Equipment.all.contains)
        original = start
        _chosen = State(initialValue: start)
    }

    private var others: [String] { Equipment.all.filter { !chosen.contains($0) } }
    private static let machinesFirst = ["machine", "cable"]
    private var machinesFirst: Bool { chosen.starts(with: Self.machinesFirst) }

    var body: some View {
        NavigationStack {
            List {
                Section { header }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())

                Section {
                    if chosen.isEmpty {
                        Label("Sin preferencia: todo el equipo vale igual.", systemImage: "equal.circle")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(Array(chosen.enumerated()), id: \.element) { index, id in
                        row(id, rank: index + 1)
                    }
                    .onMove { chosen.move(fromOffsets: $0, toOffset: $1) }
                } header: {
                    Text("Prefiero, en este orden")
                } footer: {
                    if chosen.count > 1 { Text("Arrastra para cambiar el orden.") }
                }

                if !others.isEmpty {
                    Section("Otro equipo") {
                        ForEach(others, id: \.self) { row($0, rank: nil) }
                    }
                }
            }
            .environment(\.editMode, .constant(.active))
            .animation(.snappy, value: chosen)
            .sensoryFeedback(.selection, trigger: chosen)
            .navigationTitle("Equipo preferido")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", systemImage: "checkmark") { save() }
                        .disabled(chosen == original || saving)
                }
            }
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Image(systemName: "gearshape.2.fill")
                .font(.system(size: 40, weight: .medium))
                .foregroundStyle(Theme.training.gradient)
                .symbolEffect(.rotate, value: chosen.first)
                .frame(width: 76, height: 76)
                .background(Theme.training.opacity(0.12), in: .circle)
            Text("Las alternativas y los programas del Coach empiezan por lo que pongas arriba.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Primero máquinas", systemImage: machinesFirst ? "checkmark" : "arrow.up.to.line") {
                chosen = Self.machinesFirst + chosen.filter { !Self.machinesFirst.contains($0) }
            }
            .buttonStyle(.glass)
            .tint(Theme.training)
            .disabled(machinesFirst)
            .contentTransition(.symbolEffect(.replace))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private func row(_ id: String, rank: Int?) -> some View {
        Toggle(isOn: Binding(
            get: { chosen.contains(id) },
            set: { on in
                if on { chosen.append(id) } else { chosen.removeAll { $0 == id } }
            }
        )) {
            HStack(spacing: 12) {
                Image(systemName: Equipment.symbol(id))
                    .foregroundStyle(rank == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(Theme.training))
                    .frame(width: 26)
                Text(Equipment.label(id))
                if let rank {
                    Text("\(rank)º")
                        .font(.caption.weight(.semibold))
                        .fontDesign(.rounded)
                        .monospacedDigit()
                        .foregroundStyle(Theme.training)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Theme.training.opacity(0.13), in: .capsule)
                        .contentTransition(.numericText())
                }
            }
        }
        .tint(Theme.training)
    }

    private func save() {
        saving = true
        Task {
            await TrainingStore.shared.saveSettings(TrainingSettings(preferredEquipment: chosen))
            dismiss()
        }
    }
}

#if DEBUG
#Preview("Equipo · 375 pt", traits: .fixedLayout(width: 375, height: 812)) {
    TrainingPreferencesView(preferred: ["machine", "cable"])
}

#Preview("Equipo · 440 pt, claro", traits: .fixedLayout(width: 440, height: 956)) {
    TrainingPreferencesView(preferred: []).preferredColorScheme(.light)
}

#Preview("Equipo · XXL", traits: .fixedLayout(width: 375, height: 812)) {
    TrainingPreferencesView(preferred: ["dumbbell", "machine"]).dynamicTypeSize(.xxLarge)
}
#endif
