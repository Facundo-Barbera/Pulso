import SwiftUI

extension View {
    /// The Ajustes button at the leading edge of a tab's root toolbar, with the
    /// sheet it opens. RootView applies it to every tab so features don't have to.
    /// Holding it shows a menu with Sustancias, which asks for Face ID first.
    func settingsToolbar(_ model: PulsoModel) -> some View {
        modifier(SettingsToolbar(model: model))
    }
}

private struct SettingsToolbar: ViewModifier {
    let model: PulsoModel
    @State private var showing = false
    @State private var showingSubstances = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    // A tap opens Ajustes as always; holding it shows the menu.
                    Menu {
                        Button("Ajustes", systemImage: "gearshape") { showing = true }
                        Button("Sustancias", systemImage: SubstancesAccess.symbol) {
                            Task { if await SubstancesAccess.confirm() { showingSubstances = true } }
                        }
                    } label: {
                        Image(systemName: "person.crop.circle")
                            .overlay(alignment: .topTrailing) {
                                if model.offline {
                                    Circle().fill(.orange).frame(width: 8, height: 8).offset(x: 2, y: -2)
                                        .transition(.scale)
                                }
                            }
                            .animation(.snappy, value: model.offline)
                    } primaryAction: {
                        showing = true
                    }
                    .accessibilityLabel("Ajustes")
                }
            }
            .sheet(isPresented: $showing) {
                SettingsView(model: model)
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showingSubstances) {
                NavigationStack { SubstancesView(closable: true) }
            }
    }
}
