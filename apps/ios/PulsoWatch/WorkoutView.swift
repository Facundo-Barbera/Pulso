import SwiftUI

/// The Watch's one screen. Recording: the stage, its time big, then heart
/// rate, energy and distance, with pause and end. Otherwise it says where to
/// start: the session is run from Pulso on the iPhone.
struct WorkoutView: View {
    let manager: WorkoutManager
    @State private var confirmEnd = false

    var body: some View {
        if let stage = manager.stage {
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    Label(stage.title, systemImage: stage.symbol)
                        .font(.headline)
                        .foregroundStyle(.tint)
                        .symbolEffect(.pulse, isActive: !manager.paused)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(Duration.seconds(manager.elapsed(at: context.date).rounded(.down)).formatted(.time(pattern: .hourMinuteSecond)))
                            .font(.system(size: 40, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(manager.paused ? .secondary : .primary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                    metric(manager.heartRate.map { "\(Int($0.rounded()))" } ?? "--", "ppm", symbol: "heart.fill", tint: .red)
                    metric("\(Int(manager.activeKcal.rounded()))", "kcal", symbol: "flame.fill", tint: .orange)
                    if let meters = manager.distanceMeters, meters > 0 {
                        metric((meters / 1000).formatted(.number.precision(.fractionLength(2))), "km", symbol: "ruler", tint: .cyan)
                    }
                    controls
                        .padding(.top, 6)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .animation(.snappy, value: manager.paused)
            .confirmationDialog("¿Terminar este entrenamiento?", isPresented: $confirmEnd) {
                Button("Terminar y guardar") { Task { await manager.endFromWatch() } }
                Button("Seguir", role: .cancel) {}
            } message: {
                Text("La sesión sigue en tu iPhone.")
            }
        } else {
            VStack(spacing: 10) {
                Image(systemName: "dumbbell.fill")
                    .font(.system(size: 36))
                    .foregroundStyle(.tint)
                Text("Empieza la sesión en Pulso, en tu iPhone.")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func metric(_ value: String, _ unit: String, symbol: String, tint: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Image(systemName: symbol).foregroundStyle(tint).font(.footnote)
            Text(value)
                .font(.system(.title3, design: .rounded, weight: .semibold))
                .monospacedDigit()
                .contentTransition(.numericText())
            Text(unit).font(.footnote).foregroundStyle(.secondary)
        }
        .animation(.snappy, value: value)
    }

    private var controls: some View {
        HStack(spacing: 8) {
            Button {
                manager.paused ? manager.resume() : manager.pause()
            } label: {
                Image(systemName: manager.paused ? "play.fill" : "pause.fill")
                    .contentTransition(.symbolEffect(.replace))
            }
            .tint(.yellow)
            .accessibilityLabel(manager.paused ? "Seguir" : "Pausar")
            Button { confirmEnd = true } label: {
                Image(systemName: "xmark")
            }
            .tint(.red)
            .accessibilityLabel("Terminar")
        }
        .buttonStyle(.bordered)
        .font(.title3)
    }
}
