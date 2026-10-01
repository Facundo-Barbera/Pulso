import SwiftUI

/// Set or clear the goal for one metric, seeing where the trend is now.
struct BodyGoalSheet: View {
    let store: BodyStore
    @State var metric: BodyMetric
    @State private var target: Double?
    @State private var saving = false
    @Environment(\.dismiss) private var dismiss

    init(store: BodyStore, metric: BodyMetric) {
        self.store = store
        _metric = State(initialValue: metric)
        _target = State(initialValue: store.goal(metric)?.target)
    }

    private var projection: BodyProjection? { store.projections[metric] }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Métrica", selection: $metric) {
                        ForEach(BodyMetric.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                Section {
                    HStack(alignment: .firstTextBaseline) {
                        TextField("Meta", value: $target, format: .number)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 44, weight: .bold, design: .rounded))
                        Text(metric.unit).font(.title2.weight(.semibold)).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Meta")
                } footer: {
                    if let current = projection?.current {
                        Text("Hoy tu tendencia está en \(current.decimal()) \(metric.unit).")
                    }
                }
                if let message = projection?.goal?.message, store.goal(metric)?.target == target {
                    Section { Label(message, systemImage: "flag.checkered").foregroundStyle(Theme.body) }
                }
                if store.goal(metric) != nil {
                    Section {
                        Button("Quitar meta", systemImage: "trash", role: .destructive) { save(nil) }
                    }
                }
            }
            .fontDesign(.rounded)
            .navigationTitle("Meta de \(metric.title.lowercased())")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: metric) { _, new in target = store.goal(new)?.target }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar", systemImage: "xmark", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", systemImage: "checkmark") { save(target) }
                        .buttonStyle(.glassProminent)
                        .tint(Theme.body)
                        .disabled((target ?? 0) <= 0 || saving)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save(_ value: Double?) {
        saving = true
        Task {
            await store.setGoal(metric, target: value)
            saving = false
            dismiss()
        }
    }
}
