import SwiftUI

extension View {
    /// The Ajustes button at the leading edge of a tab's root toolbar, with the
    /// sheet it opens. RootView applies it to every tab so features don't have to.
    func settingsToolbar(_ model: PulsoModel) -> some View {
        modifier(SettingsToolbar(model: model))
    }
}

private struct SettingsToolbar: ViewModifier {
    let model: PulsoModel
    @State private var showing = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showing = true } label: {
                        Image(systemName: "person.crop.circle")
                            .overlay(alignment: .topTrailing) {
                                if model.offline {
                                    Circle().fill(.orange).frame(width: 8, height: 8).offset(x: 2, y: -2)
                                        .transition(.scale)
                                }
                            }
                            .animation(.snappy, value: model.offline)
                    }
                    .accessibilityLabel("Ajustes")
                }
            }
            .sheet(isPresented: $showing) {
                SettingsView(model: model)
                    .presentationDragIndicator(.visible)
            }
    }
}
