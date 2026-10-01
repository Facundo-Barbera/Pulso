import SwiftUI

/// The Mac's tailnet address and the eight digits the desktop app shows.
struct PairView: View {
    let model: PulsoModel
    @State private var address = CredentialStore.address
    @State private var code = ""
    @FocusState private var focused: Field?

    private enum Field { case address, code }

    private var ready: Bool { code.count == 8 && !model.pairing }

    var body: some View {
        Form {
            Section {
                TextField("http://100.x.x.x:8090", text: $address)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .focused($focused, equals: .address)
            } header: {
                Text("Dirección de la Mac")
            } footer: {
                Text("La que muestra Pulso en la Mac junto al código, por Tailscale.")
            }

            Section {
                TextField("8 dígitos", text: $code)
                    .keyboardType(.numberPad)
                    .font(.system(.title2, design: .monospaced))
                    .focused($focused, equals: .code)
                    .onChange(of: code) { _, next in
                        let digits = String(next.filter(\.isNumber).prefix(8))
                        if digits != next { code = digits }
                    }
            } header: {
                Text("Código")
            } footer: {
                Text("En la Mac: iPhone → Generar código. Vale cinco minutos, una vez.")
            }

            Section {
                Button {
                    focused = nil
                    Task { await model.pair(address: address, code: code) }
                } label: {
                    HStack {
                        Text(model.pairing ? "Emparejando…" : "Emparejar")
                        if model.pairing {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(!ready)
                if let error = model.pairingError {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
            }
        }
        .navigationTitle("Pulso")
        .onAppear { focused = .code }
    }
}
